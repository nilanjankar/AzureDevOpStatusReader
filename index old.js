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

async function fetchWorkItems(workItemType) {
  const url = `${baseUrl}wit/wiql?api-version=6.0`;
  const query = {
    query: `Select [System.Id], [System.Title], [System.State], [System.AssignedTo], [Microsoft.VSTS.Scheduling.DueDate] From WorkItems Where [System.WorkItemType] = '${workItemType}' AND [System.State] <> 'Closed'`,
  };

  try {
    const response = await axios.post(url, query, { headers });
    return response.data.workItems;
  } catch (error) {
    console.error(`Error fetching ${workItemType}:`, error.message);
    return [];
  }
}

async function fetchWorkItemDetails(ids) {
  const url = `${baseUrl}wit/workitems?ids=${ids.join(',')}&$expand=relations&fields=System.Id,System.Title,System.State,System.AssignedTo,Microsoft.VSTS.Scheduling.DueDate&api-version=6.0`;

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

async function generateStatusReport(hierarchy) {
  const prompt = `Generate a status report based on the following work item hierarchy:
                  ${JSON.stringify(hierarchy, null, 2)}

                The report should include:
                1. A summary of Epics, their associated User Stories, and Tasks
                2. The total number of Epics, User Stories, and Tasks
                3. Any potential risks or blockers based on due dates or unassigned items
                4. Progress overview for each Epic

              Format the report in markdown, using appropriate headers and bullet points to show the hierarchy.`;

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
  const epicIds = await fetchWorkItems('Epic');
  const userStoryIds = await fetchWorkItems('User Story');
  const taskIds = await fetchWorkItems('Task');

  const epics = await fetchWorkItemDetails(epicIds.map(item => item.id));
  const userStories = await fetchWorkItemDetails(userStoryIds.map(item => item.id));
  const tasks = await fetchWorkItemDetails(taskIds.map(item => item.id));

  console.log('Building hierarchy...');
  const hierarchy = await buildHierarchy(epics, userStories, tasks);

  console.log('Generating status report...');
  const statusReport = await generateStatusReport(hierarchy);
  return statusReport;
}

module.exports = { main };