require('dotenv').config();
const axios = require('axios');
const OpenAI = require('openai');

// Configuration
const organization = process.env.AZURE_DEVOPS_ORG;
const project = process.env.AZURE_DEVOPS_PROJECT;
const personalAccessToken = process.env.AZURE_DEVOPS_PAT;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Azure DevOps API base URL and headers
const baseUrl = `https://dev.azure.com/${organization}/${project}/_apis/`;
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Basic ${Buffer.from(`:${personalAccessToken}`).toString('base64')}`,
};


async function fetchWorkItems() {
  const url = `${baseUrl}wit/wiql?api-version=6.0`;
  const query = {
    query: "Select [System.Id], [System.Title], [System.State], [System.AssignedTo], [Microsoft.VSTS.Scheduling.DueDate] From WorkItems Where [System.WorkItemType] = 'User Story' AND [System.State] = 'Active'",
  };

  try {
    const response = await axios.post(url, query, { headers });
    return response.data.workItems;
  } catch (error) {
    console.error('Error fetching work items:', error.message);
    return [];
  }
}

async function fetchWorkItemDetails(ids) {
  const url = `${baseUrl}wit/workitems?ids=${ids.join(',')}&fields=System.Id,System.Title,System.State,System.AssignedTo,Microsoft.VSTS.Scheduling.DueDate&api-version=6.0`;

  try {
    const response = await axios.get(url, { headers });
    return response.data.value;
  } catch (error) {
    console.error('Error fetching work item details:', error.message);
    return [];
  }
}

async function buildHierarchy(epics, userStories, tasks) {
  const hierarchy = {};

  for (const epic of epics) {
    hierarchy[epic.id] = { ...epic, userStories: {} };
  }

  for (const story of userStories) {
    const parentEpic = story.relations?.find(r => r.rel === 'Parent');
    if (parentEpic && hierarchy[parentEpic.url.split('/').pop()]) {
      const epicId = parentEpic.url.split('/').pop();
      hierarchy[epicId].userStories[story.id] = { ...story, tasks: {} };
    }
  }

  for (const task of tasks) {
    const parentStory = task.relations?.find(r => r.rel === 'Parent');
    if (parentStory) {
      const storyId = parentStory.url.split('/').pop();
      for (const epicId in hierarchy) {
        if (hierarchy[epicId].userStories[storyId]) {
          hierarchy[epicId].userStories[storyId].tasks[task.id] = task;
          break;
        }
      }
    }
  }

  return hierarchy;
}

async function generateStatusReport(workItems) {
  console.log("all workItems: ",workItems);
  const prompt = `Generate a status report based on the following work items from the project:
                  ${JSON.stringify(workItems, null, 2)}

                The report should include:
                1. A summary of active user stories with their assignee name (no email) and due dates
                2. The total number of active user stories
                3. Any potential risks or blockers based on due dates or unassigned stories
              Format the report in markdown.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error generating status report:', error.message);
    return 'Unable to generate status report.';
  }
}

async function main() {
  console.log('Fetching work items...');
  const workItemIds = await fetchWorkItems();
  if (workItemIds.length === 0) {
    return 'No work items found. Please check your project setup and permissions.';
  }

  const workItems = await fetchWorkItemDetails(workItemIds.map(item => item.id));
  if (workItems.length === 0) {
    return 'Failed to fetch work item details. Please check your permissions and API access.';
  }

  console.log('Generating status report...');
  return await generateStatusReport(workItems);
}

module.exports = { main };