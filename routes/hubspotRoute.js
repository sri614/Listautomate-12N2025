require('dotenv').config();
const express = require("express");
const router = express.Router();
const axios = require('axios');
const Segmentation = require('../models/segmentation');
const CreatedList = require('../models/list');

// Authentication middleware
function ensureAuthenticated(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

// Config
const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID;
const CONCURRENCY_LIMIT = 1;
const RETRIEVAL_BATCH_SIZE = parseInt(process.env.HUBSPOT_RETRIEVAL_BATCH_SIZE) || 1000;
const MAX_RETRIES = parseInt(process.env.HUBSPOT_MAX_RETRIES) || 3;
const INTER_LIST_DELAY_MS = parseInt(process.env.HUBSPOT_INTER_LIST_DELAY_MINUTES || 3) * 60 * 1000;

const hubspotHeaders = {
  Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
  'Content-Type': 'application/json'
};

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const getFormattedDate = (dateInput) => {
  const date = new Date(dateInput);
  return `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
};

// Updated getFilteredDate function to handle all possible date filters
const getFilteredDate = (daysFilter) => {
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  
  if (daysFilter === 'today') return today.toISOString().split('T')[0];
  
  if (daysFilter.startsWith('t+')) {
    const daysToAdd = parseInt(daysFilter.slice(2));
    if (isNaN(daysToAdd)) return null;
    
    const futureDate = new Date(today);
    futureDate.setUTCDate(today.getUTCDate() + daysToAdd);
    return futureDate.toISOString().split('T')[0];
  }
  
  return null;
};

const chunkArray = (arr, size) => {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
};

const progressiveChunks = (arr, sizes = [300, 100, 50, 1]) => {
  const result = [];
  let index = 0;
  for (const size of sizes) {
    while (index < arr.length) {
      const chunk = arr.slice(index, index + size);
      if (!chunk.length) break;
      result.push(chunk);
      index += size;
    }
  }
  return result;
};

// Legacy lists are NOT supported by v3 API - must be migrated to ILS
const getContactsFromLegacyList = async (listId, maxCount = Infinity) => {
  console.log(`❌ List ${listId} is a LEGACY list - v3 API does not support legacy lists`);
  console.log(`📋 MIGRATION REQUIRED:`);
  console.log(`   Option 1: Manually migrate in HubSpot UI (Contacts → Lists → Clone to ILS)`);
  console.log(`   Option 2: Use migration API: POST /api/migrate-legacy-list { "legacyListId": "${listId}" }`);

  throw new Error(
    `List ${listId} is a legacy list. HubSpot v3 API only supports ILS (Integrated List Segmentation) lists. ` +
    `Please migrate this list to ILS format. Migration options: ` +
    `1) HubSpot UI: Contacts → Lists → Find list ${listId} → Actions → Clone as ILS list, OR ` +
    `2) Use API: POST /api/migrate-legacy-list with body {"legacyListId": "${listId}", "newListName": "Your List Name"}`
  );
};

const getContactsFromList = async (listId, maxCount = Infinity) => {
  let allContacts = [];
  let hasMore = true;
  let after = undefined;
  let consecutiveErrors = 0;
  let totalAttempts = 0;
  let isLegacyList = false;
  let v3Success = false;

  while (hasMore && allContacts.length < maxCount) {
    try {
      const countToFetch = Math.min(RETRIEVAL_BATCH_SIZE, maxCount - allContacts.length);
      totalAttempts++;

      // Build params object for v3 API
      const params = { limit: countToFetch };
      if (after) {
        params.after = after;
      }

      const res = await axios.get(
        `https://api.hubapi.com/crm/v3/lists/${listId}/memberships`,
        {
          headers: hubspotHeaders,
          params: params,
          timeout: 30000 // 30 second timeout
        }
      );

      v3Success = true; // Mark that v3 API call succeeded
      const results = res.data.results || [];
      const newContacts = results.map(record => parseInt(record.recordId));
      allContacts.push(...newContacts);

      // v3 API uses paging with 'after' cursor
      hasMore = res.data.paging?.next?.after && allContacts.length < maxCount;
      after = res.data.paging?.next?.after;
      consecutiveErrors = 0; // Reset error counter on success

      if (allContacts.length >= maxCount) {
        allContacts = allContacts.slice(0, maxCount);
        break;
      }

      // Small delay between successful requests to avoid rate limiting
      if (hasMore) {
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (error) {
      // If 404 error on first attempt, this is likely a legacy list
      if (error.response?.status === 404 && totalAttempts === 1) {
        isLegacyList = true;
        break;
      }

      consecutiveErrors++;

      // If we have some contacts and hit an error, return what we have
      if (allContacts.length > 0 && consecutiveErrors >= MAX_RETRIES) {
        break;
      }

      // If no contacts yet and max retries reached, throw error
      if (allContacts.length === 0 && consecutiveErrors >= MAX_RETRIES) {
        console.error(`❌ Failed to fetch contacts from list ${listId}`);
        throw new Error(`Unable to fetch contacts from list ${listId}: ${error.message}`);
      }

      // Exponential backoff for retries
      const delay = Math.min(1000 * Math.pow(2, consecutiveErrors - 1), 10000);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // If v3 succeeded but returned 0 contacts, try v1 API as fallback for legacy lists
  if (v3Success && allContacts.length === 0 && !isLegacyList) {
    try {
      const legacyContacts = await getContactsFromLegacyList(listId, maxCount);
      if (legacyContacts.length > 0) {
        allContacts = legacyContacts;
      }
    } catch (legacyError) {
      // If legacy API also fails, just use the empty v3 results
    }
  } else if (isLegacyList) {
    // If detected as legacy list via 404, use v1 API
    allContacts = await getContactsFromLegacyList(listId, maxCount);
  }

  const uniqueContacts = [...new Set(allContacts)];
  return uniqueContacts;
};

// Fetch legacy segment ID for a given ILS list using Search API
const getLegacySegmentId = async (ilsListId) => {
  try {
    console.log(`  🔍 Fetching legacy segment ID for ILS list: ${ilsListId}`);

    // Use Search API with hs_classic_list_id property (the ONLY reliable way to get legacy ID)
    const searchResponse = await axios.post(
      `https://api.hubapi.com/crm/v3/lists/search`,
      {
        listIds: [String(ilsListId)],
        additionalProperties: ["hs_classic_list_id"]
      },
      { headers: hubspotHeaders }
    );

    if (searchResponse.data &&
        searchResponse.data.lists &&
        searchResponse.data.lists.length > 0) {

      const listData = searchResponse.data.lists[0];
      const legacyId = listData.additionalProperties?.hs_classic_list_id;

      if (legacyId) {
        console.log(`  ✅ Found legacy segment ID: ${legacyId} (ILS ID: ${ilsListId})`);
        return legacyId;
      } else {
        console.log(`  ⚠️ No hs_classic_list_id in response for ILS list ${ilsListId}`);
        return null;
      }
    } else {
      console.log(`  ⚠️ No lists found in search response for ILS list ${ilsListId}`);
      return null;
    }
  } catch (error) {
    console.error(`  ❌ Failed to fetch legacy segment ID for ILS list ${ilsListId}:`, error.message);
    if (error.response?.data) {
      console.error(`  Error details:`, error.response.data);
    }
    return null;
  }
};

const createHubSpotList = async (name) => {
  console.log(`📝 Creating list: ${name}`);
  try {
    const res = await axios.post(
      'https://api.hubapi.com/crm/v3/lists',
      {
        name,
        objectTypeId: '0-1', // 0-1 is for contact lists
        processingType: 'MANUAL' // MANUAL allows adding/removing via API
      },
      { headers: hubspotHeaders }
    );

    // HubSpot v3 API nests the list data under 'list' property
    const listData = res.data.list || res.data;

    // Ensure listId exists in response
    if (!listData.listId) {
      throw new Error('List created but listId not returned from HubSpot API');
    }

    // Fetch the legacy segment ID after list creation
    const legacyListId = await getLegacySegmentId(listData.listId);

    // Add legacy ID to the returned data
    return {
      ...listData,
      legacyListId
    };
  } catch (error) {
    console.error(`❌ Failed to create list: ${name}`);
    throw error;
  }
};

const verifyListIsManual = async (listId) => {
  try {
    const res = await axios.get(
      `https://api.hubapi.com/crm/v3/lists/${listId}`,
      { headers: hubspotHeaders }
    );

    // HubSpot v3 API may return data nested under 'list' property or at root level
    const listData = res.data.list || res.data;

    const processingType = listData.processingType || listData.processing_type;

    if (!processingType || processingType !== 'MANUAL') {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
};

const addContactsToList = async (listId, contacts, skipVerification = false) => {
  if (!contacts || contacts.length === 0) {
    return 0;
  }

  // Verify list is MANUAL before attempting to add contacts (unless skipped)
  if (!skipVerification) {
    const isManual = await verifyListIsManual(listId);
    if (!isManual) {
      return 0;
    }
  }

  const chunks = progressiveChunks(contacts);
  let successCount = 0;
  let failedChunks = [];

  for (const [index, chunk] of chunks.entries()) {
    let retries = 0;
    let success = false;

    while (retries < MAX_RETRIES && !success) {
      try {
        // v3 API expects a direct array of string IDs (not wrapped in an object!)
        const stringIds = chunk.map(id => String(id));

        await axios.put(
          `https://api.hubapi.com/crm/v3/lists/${listId}/memberships/add`,
          stringIds,  // Send array directly, not { recordIds: [...] }
          {
            headers: hubspotHeaders,
            timeout: 30000
          }
        );
        console.log(`✅ Added chunk of ${chunk.length} contacts to list ${listId}`);
        successCount += chunk.length;
        success = true;
        await new Promise(r => setTimeout(r, 500));
      } catch (error) {
        retries++;

        if (retries < MAX_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, retries - 1), 5000);
          await new Promise(r => setTimeout(r, delay));
        } else {
          failedChunks.push(chunk);
        }
      }
    }
  }

  return successCount;
};

const updateContactProperties = async (contactIds, dateValue, brandValue) => {
  const epochMidnight = new Date(dateValue);
  epochMidnight.setUTCHours(0, 0, 0, 0);
  const epochTime = epochMidnight.getTime().toString();

  const chunks = chunkArray(contactIds, 100);
  console.log(`🕓 Updating properties for ${contactIds.length} contacts`);

  for (const chunk of chunks) {
    const payload = {
      inputs: chunk.map(contactId => ({
        id: contactId.toString(),
        properties: {
          recent_marketing_email_sent_date: epochTime,
          last_marketing_email_sent_brand: brandValue
        }
      }))
    };

    try {
      await axios.post(
        'https://api.hubapi.com/crm/v3/objects/contacts/batch/update',
        payload,
        { headers: hubspotHeaders }
      );
      console.log(`✅ Updated batch of ${chunk.length} contacts`);
    } catch (err) {
      console.error(`❌ Failed batch update`);
    }

    await new Promise(r => setTimeout(r, 300));
  }
};

const processSingleCampaign = async (config, daysFilter, modeFilter, usedContactsSet) => {
  const { brand, campaign, primaryListId, secondaryListId, count, domain, date, sendContactListId, lastMarketingEmailSentBrand } = config;

  console.log(`🚀 Starting campaign: ${campaign} | Brand: ${brand} | Domain: ${domain}`);

  let primaryContacts = [];
  let secondaryContacts = [];
  let primaryBeforeFilter = 0;
  let primaryAfterFilter = 0;
  let secondaryBeforeFilter = 0;
  let secondaryAfterFilter = 0;

  try {
    // Fetch more contacts than needed to account for filtering
    const primaryFetchCount = Math.max(count * 3, 500); // Fetch at least 3x or 500 minimum
    primaryContacts = await getContactsFromList(primaryListId, primaryFetchCount);
    primaryBeforeFilter = primaryContacts.length;

    // Filter out used contacts
    primaryContacts = primaryContacts.filter(vid => !usedContactsSet.has(vid));
    primaryAfterFilter = primaryContacts.length;

    // If we need more contacts and have a secondary list
    if (primaryAfterFilter < count && secondaryListId) {
      const secondaryNeeded = count - primaryAfterFilter;
      const secondaryFetchCount = Math.max(secondaryNeeded * 3, 500);

      secondaryContacts = await getContactsFromList(secondaryListId, secondaryFetchCount);
      secondaryBeforeFilter = secondaryContacts.length;

      secondaryContacts = secondaryContacts.filter(vid => !usedContactsSet.has(vid));
      secondaryAfterFilter = secondaryContacts.length;
    }
  } catch (error) {
    console.error(`❌ Error fetching contacts for campaign ${campaign}`);
    // Continue with whatever contacts we have
  }

  // Combine all available contacts
  const allContacts = [...primaryContacts, ...secondaryContacts];

  // Take what we can, up to the requested count
  const selectedContacts = allContacts.slice(0, count);

  // Add selected contacts to used set
  selectedContacts.forEach(vid => usedContactsSet.add(vid));

  const fulfillmentPercentage = count > 0 ? Math.round((selectedContacts.length / count) * 100) : 0;

  // Log primary and secondary list info
  console.log(`📥 Primary List: ${primaryBeforeFilter} available | ${primaryBeforeFilter - primaryAfterFilter} filtered | ${primaryAfterFilter} remaining`);
  if (secondaryListId) {
    console.log(`📥 Secondary List: ${secondaryBeforeFilter} available | ${secondaryBeforeFilter - secondaryAfterFilter} filtered | ${secondaryAfterFilter} remaining`);
  }
  console.log(`✂️ Final Selection: ${selectedContacts.length} of ${count} requested (${fulfillmentPercentage}%)`);

  const listName = `${brand} - ${campaign} - ${domain} - ${getFormattedDate(date)}`;

  // Always create the list even if empty (for tracking purposes)
  const newList = await createHubSpotList(listName);

  let actualContactsAdded = 0;

  if (selectedContacts.length > 0) {
    try {
      // Add to send contact list if specified (skip verification to bypass API parsing issue)
      if (sendContactListId) {
        await addContactsToList(sendContactListId, selectedContacts, true);
      }

      // Add to the newly created list (skip verification - we know it's MANUAL since we just created it)
      actualContactsAdded = await addContactsToList(newList.listId, selectedContacts, true);

      // Update contact properties
      await updateContactProperties(selectedContacts, date, lastMarketingEmailSentBrand);
    } catch (error) {
      console.error(`❌ Error adding contacts for ${campaign}`);
      // Continue even if there's an error adding contacts
    }
  }

  console.log(`✅ List created: ${listName} | ILS ID: ${newList.listId} | Legacy ID: ${newList.legacyListId || 'N/A'}`);

  const createdList = await CreatedList.create({
    name: listName,
    listId: newList.listId,
    legacyListId: newList.legacyListId, // Store legacy segment ID
    createdDate: new Date(),
    deleted: newList.deleted,
    filterCriteria: { days: daysFilter, mode: modeFilter },
    campaignDetails: { brand, campaign, date },
    contactCount: actualContactsAdded, // Use actual count, not selectedContacts.length
    requestedCount: count,
    availableCount: primaryBeforeFilter + secondaryBeforeFilter,
    filteredCount: (primaryBeforeFilter - primaryAfterFilter) + (secondaryBeforeFilter - secondaryAfterFilter),
    fulfillmentPercentage
  });

  return {
    success: true,
    listName,
    listId: newList.listId,
    legacyListId: newList.legacyListId, // Include in return value
    contactCount: actualContactsAdded, // Use actual count, not selectedContacts.length
    requestedCount: count,
    availableCount: primaryBeforeFilter + secondaryBeforeFilter,
    filteredCount: (primaryBeforeFilter - primaryAfterFilter) + (secondaryBeforeFilter - secondaryAfterFilter),
    fulfillmentPercentage,
    createdList
  };
};

const processCampaignsWithDelay = async (listConfigs, daysFilter, modeFilter) => {
  const results = [];
  const usedContacts = new Set();

  for (const [index, config] of listConfigs.entries()) {
    const startTime = Date.now();
    const currentIndex = index + 1;
    const total = listConfigs.length;

    try {
      const result = await processSingleCampaign(config, daysFilter, modeFilter, usedContacts);
      results.push({ status: 'fulfilled', value: result });

      if (index < total - 1) {
        const elapsed = Date.now() - startTime;
        const delay = Math.max(0, INTER_LIST_DELAY_MS - elapsed);
        await new Promise(r => setTimeout(r, delay));
      }
    } catch (error) {
      console.error(`❌ Campaign failed: ${config.campaign}`);
      results.push({ status: 'rejected', reason: error });

      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, INTER_LIST_DELAY_MS - elapsed);
      if (index < listConfigs.length - 1) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  const successful = results.filter(r => r.status === 'fulfilled');
  const failed = results.filter(r => r.status === 'rejected');

  console.log(`\n🎯 Campaign run complete`);
  console.log(`✅ Success: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  console.log(`📊 Total Requested: ${listConfigs.reduce((sum, c) => sum + c.count, 0)}`);
  console.log(`📊 Total Fulfilled: ${successful.reduce((sum, r) => sum + r.value.contactCount, 0)}`);
  console.log(`📊 Average Fulfillment: ${Math.round(successful.reduce((sum, r) => sum + r.value.fulfillmentPercentage, 0) / (successful.length || 1))}%`);

  return results;
};

// Updated route handler with better validation
router.post('/create-lists', async (req, res) => {
  try {
    const { daysFilter, modeFilter } = req.body;
    console.log(`📨 Received request to create lists | Filters → Days: ${daysFilter}, Mode: ${modeFilter}`);

    // Validate input parameters
    const validDaysFilters = ['today', 't+1', 't+2', 't+3', 'all'];
    const validModeFilters = ['BAU', 're-engagement', 're-activation'];
    
    if (!daysFilter || !validDaysFilters.includes(daysFilter)) {
      return res.status(400).json({ 
        error: 'Invalid date filter',
        message: `Valid values are: ${validDaysFilters.join(', ')}`,
        received: daysFilter
      });
    }

    if (!modeFilter || !validModeFilters.includes(modeFilter)) {
      return res.status(400).json({ 
        error: 'Invalid mode filter',
        message: `Valid values are: ${validModeFilters.join(', ')}`,
        received: modeFilter
      });
    }

    let query = {};

    if (daysFilter && daysFilter !== 'all') {
      const filterDate = getFilteredDate(daysFilter);
      if (!filterDate) {
        return res.status(400).json({ 
          error: 'Invalid date filter value',
          message: 'Could not calculate date from filter',
          received: daysFilter
        });
      }
      query.date = filterDate;
    }

    if (modeFilter && modeFilter !== 'BAU') {
      query.campaign = { $regex: modeFilter === 're-engagement' ? /re-engagement/i : /re-activation/i };
    } else if (modeFilter === 'BAU') {
      query.$and = [
        { campaign: { $not: { $regex: /re-engagement/i } } },
        { campaign: { $not: { $regex: /re-activation/i } } }
      ];
    }

    const listConfigs = await Segmentation.find(query).sort({ order: 1 }).lean();
    if (!listConfigs.length) {
      return res.status(404).json({ 
        error: 'No campaigns match the selected filters',
        filters: { daysFilter, modeFilter }
      });
    }

    res.json({
      message: `🚀 Background processing started with ${INTER_LIST_DELAY_MS / 60000}-minute delay`,
      count: listConfigs.length,
      firstCampaign: listConfigs[0]?.campaign || 'None',
      totalContactsRequested: listConfigs.reduce((sum, c) => sum + c.count, 0),
      estimatedCompletionTime: `${Math.ceil(listConfigs.length * INTER_LIST_DELAY_MS / 3600000)} hrs ${Math.ceil((listConfigs.length * INTER_LIST_DELAY_MS % 3600000) / 60000)} mins`
    });

    setImmediate(async () => {
      try {
        await processCampaignsWithDelay(listConfigs, daysFilter, modeFilter);
      } catch (error) {
        console.error('❌ Overall process failed:', error.message);
      }
    });

  } catch (error) {
    console.error('Error in /create-lists:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Rest of the routes remain unchanged
router.get('/created-lists', async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(startOfDay.getUTCDate() + 1);

    const lists = await CreatedList.find({
      createdDate: {
        $gte: startOfDay,
        $lt: endOfDay
      }
    }).sort({ createdDate: -1 }).lean();

    res.json(lists);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch created lists' });
  }
});

// Updated route for List Manager
router.get('/list-manager', ensureAuthenticated, async (req, res) => {
  try {
    const showAll = req.query.show === 'all';
    const jsonFormat = req.query.json === 'true';
    const filter = showAll ? {} : { deleted: { $ne: true } };
    
    const lists = await CreatedList.find(filter)
      .sort({ createdDate: -1 })
      .lean();

    const formattedLists = lists.map(list => ({
      ...list,
      formattedDate: formatDateForDisplay(list.createdDate),
      createdDate: list.createdDate
    }));

    // Always return JSON when json=true is specified
    if (jsonFormat) {
      return res.json(formattedLists);
    }

    return res.render('listManager', {
      lists: formattedLists,
      showAll,
      pageTitle: "List Manager",
      activePage: "list manager"
    });

  } catch (error) {
    console.error('Error:', error);
    if (req.query.json === 'true') {
      return res.status(500).json({ error: 'Server error' });
    }
    res.status(500).send('Server error');
  }
});

// Keep old route for backward compatibility
router.get('/list-cleaner', ensureAuthenticated, async (req, res) => {
  try {
    const showAll = req.query.show === 'all';
    const jsonFormat = req.query.json === 'true';
    const filter = showAll ? {} : { deleted: { $ne: true } };
    
    const lists = await CreatedList.find(filter)
      .sort({ createdDate: -1 })
      .lean();

    const formattedLists = lists.map(list => ({
      ...list,
      formattedDate: formatDateForDisplay(list.createdDate),
      createdDate: list.createdDate
    }));

    // Always return JSON when json=true is specified
    if (jsonFormat) {
      return res.json(formattedLists);
    }

    return res.render('deletedLists', {
      lists: formattedLists,
      showAll,
      pageTitle: "List Cleaner",
      activePage: "list cleaning"
    });

  } catch (error) {
    console.error('Error:', error);
    if (req.query.json === 'true') {
      return res.status(500).json({ error: 'Server error' });
    }
    return res.status(500).send('Server error');
  }
});
// Date formatting helper
function formatDateForDisplay(date) {
  const d = new Date(date);
  const day = d.getDate();
  const month = d.toLocaleString('en-US', { month: 'short' });
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  
  return `${day} ${month} ${year} ${hours}:${minutes}${ampm}`;
}

// Fetch HubSpot property options for last_marketing_email_sent_brand
router.get('/hubspot-brand-options', ensureAuthenticated, async (req, res) => {
  try {
    const response = await axios.get(
      'https://api.hubapi.com/crm/v3/properties/contacts/last_marketing_email_sent_brand',
      { headers: hubspotHeaders }
    );

    const options = response.data.options || [];
    const formattedOptions = options.map(opt => ({
      label: opt.label,
      value: opt.value
    }));

    res.json({
      success: true,
      options: formattedOptions
    });
  } catch (error) {
    console.error('Error fetching HubSpot brand options:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to fetch brand options from HubSpot'
    });
  }
});

// Include a HubSpot list in an email
router.post('/include-list-in-email', ensureAuthenticated, async (req, res) => {
  const { emailId, listId, emailName, listName } = req.body;

  try {
    console.log(`\n📧 Including list in email: ${emailName} (List ID: ${listId})`);

    // Fetch and store legacy ID for reference
    const legacyListId = await getLegacySegmentId(listId);
    if (legacyListId) {
      const listRecord = await CreatedList.findOne({ listId: parseInt(listId) });
      if (listRecord && listRecord.legacyListId !== legacyListId) {
        listRecord.legacyListId = legacyListId;
        await listRecord.save();
      }
    }

    // Get current email details
    const emailResponse = await axios.get(
      `https://api.hubapi.com/marketing/v3/emails/${emailId}`,
      { headers: hubspotHeaders }
    );

    const currentEmail = emailResponse.data;

    // Check if email is in DRAFT state
    if (currentEmail.state && currentEmail.state !== 'DRAFT') {
      return res.json({
        success: false,
        message: `Email is in ${currentEmail.state} state. Only DRAFT emails can have their lists updated.`,
        data: currentEmail
      });
    }

    // Use the modern 'to.contactLists' format with legacy IDs (proven to work)
    const legacyListIdStr = String(legacyListId);
    const currentListsInclude = currentEmail.to?.contactLists?.include || [];
    const currentListsExclude = currentEmail.to?.contactLists?.exclude || [];

    // Check if already included
    if (currentListsInclude.includes(legacyListIdStr) || currentListsInclude.includes(parseInt(legacyListId))) {
      return res.json({
        success: true,
        message: 'List is already included in this email',
        emailId: emailId,
        ilsListId: listId,
        legacyListId: legacyListId
      });
    }

    // Add legacy ID to contactLists.include
    const updatedListsInclude = [...new Set([...currentListsInclude, legacyListIdStr])];

    const updatePayload = {
      to: {
        contactLists: {
          exclude: currentListsExclude,
          include: updatedListsInclude
        }
      }
    };

    // Update the email using the proven curl pattern (without /draft)
    const updateResponse = await axios.patch(
      `https://api.hubapi.com/marketing/v3/emails/${emailId}`,
      updatePayload,
      { headers: hubspotHeaders }
    );

    // Verify the email was updated
    let listWasAdded = false;
    let actualIncludedLists = [];
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const verifyResponse = await axios.get(
        `https://api.hubapi.com/marketing/v3/emails/${emailId}`,
        { headers: hubspotHeaders }
      );

      const verifiedEmail = verifyResponse.data;
      const verifiedListsInclude = verifiedEmail.to?.contactLists?.include || [];

      // Check if the legacy ID was added to contactLists.include
      listWasAdded = verifiedListsInclude.includes(legacyListIdStr) ||
                     verifiedListsInclude.includes(parseInt(legacyListId));

      actualIncludedLists = verifiedListsInclude;

      if (listWasAdded) {
        break;
      }
    }

    if (!listWasAdded) {
      return res.json({
        success: false,
        message: 'List update may still be in progress. Please verify in HubSpot.',
        emailId: emailId,
        ilsListId: listId,
        legacyListId: legacyListId
      });
    }

    console.log(`✅ List successfully added to email: ${emailName}`);

    return res.json({
      success: true,
      message: 'List successfully added to email',
      emailId: emailId,
      ilsListId: listId,
      legacyListId: legacyListId
    });

  } catch (error) {
    console.error('❌ HubSpot API error:', error.response?.data || error.message);

    if (error.response?.data) {
      console.error('Full error details:', JSON.stringify(error.response.data, null, 2));
    }

    // Provide more specific error messages
    let errorMessage = 'Failed to include list in email';
    if (error.response?.status === 404) {
      errorMessage = `Email ${emailId} or list ${listId} not found in HubSpot`;
    } else if (error.response?.status === 401) {
      errorMessage = 'HubSpot authentication failed - check access token';
    } else if (error.response?.status === 400) {
      errorMessage = `Invalid request - ${error.response?.data?.message || 'check email and list IDs'}`;
    } else if (error.response?.status === 403) {
      errorMessage = 'Permission denied - this email may be locked or require manual configuration';
    } else if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    }

    res.status(error.response?.status || 500).json({
      success: false,
      message: errorMessage,
      details: error.response?.data || error.message,
      suggestion: 'If this is a cloned email, you may need to add lists manually in the HubSpot UI'
    });
  }
});

// Debug endpoint to inspect email structure
router.get('/debug-email/:emailId', ensureAuthenticated, async (req, res) => {
  try {
    const emailId = req.params.emailId;
    console.log(`\n🔍 Debugging email: ${emailId}`);

    const response = await axios.get(
      `https://api.hubapi.com/marketing/v3/emails/${emailId}`,
      { headers: hubspotHeaders }
    );

    const emailData = response.data;

    // Extract all recipient-related fields
    const recipientInfo = {
      emailId: emailId,
      name: emailData.name,
      state: emailData.state,
      mailingListsIncluded: emailData.mailingListsIncluded,
      mailingListsExcluded: emailData.mailingListsExcluded,
      to: emailData.to,
      from: emailData.from,
      replyTo: emailData.replyTo,
      // Check for any other recipient fields
      contactListIds: emailData.contactListIds,
      listIds: emailData.listIds,
      recipients: emailData.recipients,
      audienceCriteria: emailData.audienceCriteria,
      fullData: emailData // Include everything for inspection
    };

    console.log(`Email Debug Info:`, JSON.stringify(recipientInfo, null, 2));

    res.json({
      success: true,
      data: recipientInfo
    });

  } catch (error) {
    console.error('Debug error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// Migration guide endpoint - provides instructions for manual migration
router.get('/migration-guide/:legacyListId?', ensureAuthenticated, async (req, res) => {
  const legacyListId = req.params.legacyListId;

  const guide = {
    message: "Legacy lists must be migrated to ILS format in HubSpot UI",
    reason: "HubSpot v3 API only supports ILS (Integrated List Segmentation) lists, not legacy static lists",
    migrationSteps: [
      {
        step: 1,
        title: "Open HubSpot",
        description: "Go to Contacts → Lists in your HubSpot account"
      },
      {
        step: 2,
        title: "Find your legacy list",
        description: legacyListId
          ? `Search for list ID: ${legacyListId}`
          : "Search for your legacy list by ID or name"
      },
      {
        step: 3,
        title: "Clone to ILS format",
        description: "Click Actions → Clone list → Choose 'Active list' or 'Static list (ILS)' → Save"
      },
      {
        step: 4,
        title: "Get new list ID",
        description: "After cloning, note down the new ILS list ID from the list URL or settings"
      },
      {
        step: 5,
        title: "Update your database",
        description: "Replace the old legacy list ID with the new ILS list ID in your segmentation collection"
      }
    ],
    databaseUpdateExample: legacyListId ? {
      mongodb: `db.segmentation.updateMany({ primaryListId: "${legacyListId}" }, { $set: { primaryListId: "NEW_ILS_LIST_ID" } })`,
      note: "Replace NEW_ILS_LIST_ID with the ID from step 4"
    } : null,
    yourLegacyLists: legacyListId ? [legacyListId] : ["24920", "24921"],
    estimatedTime: "5-10 minutes per list"
  };

  res.json(guide);
});

// Diagnostic endpoint - Check what IDs HubSpot returns for a list
router.get('/debug-list-ids/:ilsListId', ensureAuthenticated, async (req, res) => {
  const ilsListId = req.params.ilsListId;

  try {
    console.log(`\n🔍 DEBUG: Fetching all IDs for ILS list: ${ilsListId}`);

    // Get list details from HubSpot v3 API
    const hubspotResponse = await axios.get(
      `https://api.hubapi.com/crm/v3/lists/${ilsListId}`,
      { headers: hubspotHeaders }
    );

    const listData = hubspotResponse.data.list || hubspotResponse.data;

    // Check database
    const dbRecord = await CreatedList.findOne({ listId: parseInt(ilsListId) });

    const debugInfo = {
      input: {
        ilsListId: ilsListId
      },
      hubspotApiResponse: {
        listId: listData.listId,
        id: listData.id,
        ilsListId: listData.ilsListId,
        legacyListId: listData.legacyListId,
        parentId: listData.parentId,
        name: listData.name,
        allKeys: Object.keys(listData)
      },
      database: dbRecord ? {
        listId: dbRecord.listId,
        legacyListId: dbRecord.legacyListId,
        name: dbRecord.name
      } : null,
      recommendation: {
        correctLegacyId: listData.legacyListId || listData.parentId || listData.listId,
        needsUpdate: dbRecord && dbRecord.legacyListId !== (listData.legacyListId || listData.parentId || listData.listId),
        note: "If HubSpot UI shows different 'LIST ID', that is the correct legacy segment ID to use for emails"
      }
    };

    res.json(debugInfo);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      note: 'Failed to fetch list details from HubSpot'
    });
  }
});

// Utility endpoint - Update legacy ID in database for a specific list
router.post('/update-legacy-id', ensureAuthenticated, async (req, res) => {
  const { ilsListId, correctLegacyId } = req.body;

  if (!ilsListId || !correctLegacyId) {
    return res.json({
      success: false,
      message: 'Both ilsListId and correctLegacyId are required'
    });
  }

  try {
    const listRecord = await CreatedList.findOne({ listId: parseInt(ilsListId) });

    if (!listRecord) {
      return res.json({
        success: false,
        message: `No database record found for ILS list ID: ${ilsListId}`
      });
    }

    const oldLegacyId = listRecord.legacyListId;
    listRecord.legacyListId = correctLegacyId;
    await listRecord.save();

    console.log(`✅ Updated legacy ID for list ${ilsListId}: ${oldLegacyId} → ${correctLegacyId}`);

    res.json({
      success: true,
      message: 'Legacy ID updated successfully',
      ilsListId: ilsListId,
      oldLegacyId: oldLegacyId,
      newLegacyId: correctLegacyId,
      listName: listRecord.name
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;