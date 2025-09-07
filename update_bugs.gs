function importJiraBugs() {
  // Load credentials from ENV (env.gs)
  const email = ENV.EMAIL;
  const apiToken = ENV.API_TOKEN;
  const domain = ENV.DOMAIN;
  const projectName = ENV.PROJECT_NAME;
 const jql = `project = ${projectName} AND issuetype = Bug ORDER BY created DESC`;

  const url = `https://${domain}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=summary,status,priority,assignee,reporter,created,updated,description,parent,attachment`;
  const headers = {
    "Authorization": "Basic " + Utilities.base64Encode(email + ":" + apiToken),
    "Accept": "application/json"
  };

  const priorityOptions = ["High", "Medium", "Low"];
  const statusOptions = ["To Do", "In Progress","Testing", "Pushed to Staging", "Tested & Ready for Prod", "Done", "On Hold", "Being Designed", "🚀 Released"];

  const response = UrlFetchApp.fetch(url, { headers });
  const issues = JSON.parse(response.getContentText()).issues;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Jira Bugs");
  if (!sheet) {
    sheet = ss.insertSheet("Jira Bugs");
    sheet.appendRow([
      "Bug ID", "Summary", "Description",
      "Environment", "Step-by-step", "Expected result", "Actual result", "Severity",
      "Priority", "Status", "Assignee", "Reporter", "Created", "Updated",
      "Parent ID", "Parent Key", "Parent Summary",
      "Attachments", "PR"
    ]);
  }

  const existingData = sheet.getDataRange().getValues();
  const header = existingData[0];
  const idIndex = 0;

  const preservedDataMap = {};
  for (let i = 1; i < existingData.length; i++) {
    const row = existingData[i];
    const bugId = row[idIndex];
    if (bugId) {
      preservedDataMap[bugId] = row.slice(3, 8); // D to H (Environment to Severity)
    }
  }

  // Clear all rows except header
  const numRows = sheet.getLastRow();
  if (numRows > 1) {
    sheet.getRange(2, 1, numRows - 1, sheet.getLastColumn()).clearContent();
  }

  let newRows = issues.map(issue => {
    const fields = issue.fields;
    const description = parseADFToPlainText(fields.description);
    const parent = fields.parent || {};
    const attachments = fields.attachment || [];
    const attachmentLinks = attachments
      .map(att => `${att.filename}: ${att.content}`)
      .join("\n");

    const preserved = preservedDataMap[issue.key] || ["", "", "", "", ""]; // D to H

    const prLinks = getWebLinks(issue.key, email, apiToken, domain);

    return [
      issue.key,
      fields.summary || "",
      description,
      ...preserved, // D to H
      priorityOptions.includes(fields.priority?.name) ? fields.priority.name : "",
      statusOptions.includes(fields.status?.name) ? fields.status.name : "",
      fields.assignee?.displayName || "",
      fields.reporter?.displayName || "",
      fields.created?.replace("T", " ").substring(0, 16) || "",
      fields.updated?.replace("T", " ").substring(0, 16) || "",
      parent.id || "",
      parent.key || "",
      parent.fields?.summary || "",
      attachmentLinks,
      prLinks
    ];
  });

  // Write all rows in batch
  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, newRows[0].length).setValues(newRows);
    sheet.getRange(2, 1, newRows.length, newRows[0].length).setWrap(true);
  }
}

function parseADFToPlainText(adf) {
  let result = "";

  function walk(node) {
    if (!node) return;

    if (node.type === "text") {
      result += node.text || "";
    } else if (node.content && Array.isArray(node.content)) {
      node.content.forEach(walk);
      if (node.type === "paragraph") result += "\n";
    }
  }

  if (adf && adf.type === "doc" && Array.isArray(adf.content)) {
    adf.content.forEach(walk);
  }

  return result.trim();
}

function getWebLinks(issueKey, email, apiToken, domain) {
  const url = `https://${domain}/rest/api/3/issue/${issueKey}/remotelink`;
  const headers = {
    "Authorization": "Basic " + Utilities.base64Encode(email + ":" + apiToken),
    "Accept": "application/json"
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      headers,
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      console.info(`Failed to fetch PR links for ${issueKey}: ${response.getContentText()}`);
      return "";
    }

    const links = JSON.parse(response.getContentText());
    return links
      .map(link => {
        const title = link.object?.title || "Link";
        const url = link.object?.url || "";
        return `${title}: ${url}`;
      })
      .join("\n");

  } catch (e) {
    console.error(`Error fetching web links for ${issueKey}: ${e}`);
    return "";
  }
}


