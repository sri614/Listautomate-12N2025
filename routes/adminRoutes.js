const express = require("express");
const router = express.Router();
const axios = require('axios');
const Segmentation = require("../models/segmentation");
const CreatedList = require("../models/list");
const ClonedEmail = require("../models/clonedEmail");
const { runDataRetentioncleanup, getRetentionCutoffDate, RETENTION_DAYS } = require("../service/dataRetention");

// HubSpot configuration
const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const hubspotHeaders = {
  'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
  'Content-Type': 'application/json'
};

// 🔒 Middleware to protect private routes
function ensureAuthenticated(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}
 


router.get("/login", async (req, res) => {
  try {
    res.render("login", {
        pageTitle: "ED Automation",
      activePage: "ED Automation"
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ msg: "Unable to get emails" });
  }
});


// ✔️ CREATE email (protected)
router.post("/add-email", ensureAuthenticated, async (req, res) => {
  try {
    const newEmail = new Segmentation(req.body);
    await newEmail
      .save()
      .then((savedEmail) => {
        console.log("saved:", savedEmail);
        res.status(200).redirect("/");
      })
      .catch((error) => {
        console.log(error);
      });
  } catch (error) {
    console.log(error);
    res.status(500).json({ msg: "unable to create new Email" });
  }
});

// ✔️ READ all emails (protected)
router.get("/", ensureAuthenticated, async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(startOfDay.getUTCDate() + 1);

    const lists = await CreatedList.find({
      createdDate: { $gte: startOfDay, $lt: endOfDay }
    }).sort({ createdDate: -1 }).lean();

    await Segmentation.find().sort({ order: 1 }).lean()
      .then((emails) => {
        res.status(200).render("index", {
          emails: JSON.parse(JSON.stringify(emails)),
          hasEmails: emails.length > 0,
          lists: JSON.parse(JSON.stringify(lists)),
          hasLists: lists.length > 0,
          isEdit: false,
          pageTitle: "ED Automation",
          activePage: "ED Automation",
        });
      })
      .catch((error) => {
        console.log(error);
        res.status(500).json({ msg: "Unable to get emails" });
      });
  } catch (error) {
    console.log(error);
    res.status(500).json({ msg: "Unable to get emails" });
  }
});

// ✔️ UPDATE (protected)
router.put("/email/:id/edit", ensureAuthenticated, async (req, res) => {
  try {
    const id = req.params.id;
    const updatedEmail = req.body;
    await Segmentation.findOneAndUpdate({ _id: id }, updatedEmail, { new: true })
      .then((updatedEmail) => {
        console.log("updated:", updatedEmail);
        res.redirect("/");
      })
      .catch((error) => {
        console.log(error);
        res.status(500).json({ msg: "Unable to update the contact" });
      });
  } catch (error) {
    console.log(error);
    res.status(500).json({ msg: "Unable to update the contact" });
  }
});

// ✔️ UPDATE DATE ONLY (protected)
router.put("/email/:id/update-date", ensureAuthenticated, async (req, res) => {
  try {
    const id = req.params.id;
    const { date } = req.body;

    if (!date) {
      return res.status(400).json({ msg: "Date is required" });
    }

    await Segmentation.findByIdAndUpdate(
      id,
      { date: date }, // Store as string, not Date object
      { new: true }
    )
      .then((updatedEmail) => {
        console.log("Date updated for:", id);
        res.status(200).json({ success: true, email: updatedEmail });
      })
      .catch((error) => {
        console.log(error);
        res.status(500).json({ msg: "Unable to update the date" });
      });
  } catch (error) {
    console.log(error);
    res.status(500).json({ msg: "Unable to update the date" });
  }
});

// ✔️ DELETE (protected)
router.delete("/email/:id", ensureAuthenticated, async (req, res) => {
  try {
    const id = req.params.id;
    await Segmentation.findByIdAndDelete(id)
      .then((deletedEmail) => {
        console.log("deleted", deletedEmail);
        res.redirect("/");
      })
      .catch((error) => {
        console.log(error);
        res.status(500).json({ msg: "Unable to delete the email" });
      });
  } catch (error) {
    console.log(error);
    res.status(500).json({ msg: "Unable to delete the email" });
  }
});

// ✔️ SEGMENTATION REORDER (protected)
router.post('/api/segmentations/reorder', ensureAuthenticated, async (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ success: false, message: "Invalid input" });
  }

  try {
    const bulkOps = orderedIds.map((id, index) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { order: index } }
      }
    }));

    await Segmentation.bulkWrite(bulkOps);
    res.json({ success: true });
  } catch (err) {
    console.error("Reorder failed:", err);
    res.status(500).json({ success: false });
  }
});

// ✔️ DOCS PAGE (protected)
// Updated route for Email Publisher
router.get('/email-publisher', ensureAuthenticated, async (req, res) => {
  try {
    res.render("emailPublisher", {
      pageTitle: "Email Publisher",
      activePage: "email publisher",
    });
  } catch (err) {
    console.error("failed:", err);
    res.status(500).json({ success: false });
  }
});

// Keep old route for backward compatibility
router.get('/docs', ensureAuthenticated, async (req, res) => {
  try {
    res.render("docs", {
      pageTitle: "docs",
      activePage: "docs",
    });
  } catch (err) {
    console.error("failed:", err);
    res.status(500).json({ success: false });
  }
});

// ✔️ cleanup PAGE (protected)
router.get('/cleanup', ensureAuthenticated, async (req, res) => {
  try {
    res.render("cleanup", {
      pageTitle: "cleanup",
      activePage: "cleanup",
    });
  } catch (err) {
    console.error("cleanup route failed:", err);
    res.status(500).json({ success: false });
  }
});

// ✔️ DATA RETENTION - Manual cleanup trigger (protected)
router.post('/data-retention/cleanup', ensureAuthenticated, async (req, res) => {
  try {
    console.log(`[Data Retention] Manual cleanup triggered by user: ${req.session.user}`);

    const results = await runDataRetentioncleanup();

    res.json({
      success: true,
      message: 'Data retention cleanup completed',
      results: results,
      summary: {
        clonedEmailsDeleted: results.clonedEmails.deletedCount,
        createdListsDeleted: results.createdLists.deletedCount,
        totalDeleted: results.clonedEmails.deletedCount + results.createdLists.deletedCount,
        retentionDays: RETENTION_DAYS
      }
    });
  } catch (err) {
    console.error("[Data Retention] Manual cleanup failed:", err);
    res.status(500).json({
      success: false,
      message: 'Data retention cleanup failed',
      error: err.message
    });
  }
});

// ✔️ DATA RETENTION - Get status (protected)
router.get('/data-retention/status', ensureAuthenticated, async (req, res) => {
  try {
    const cutoffDate = getRetentionCutoffDate();

    // Count how many records will be deleted
    const clonedEmailsCount = await require("../models/clonedEmail").countDocuments({
      createdAt: { $lt: cutoffDate }
    });

    const createdListsCount = await CreatedList.countDocuments({
      createdDate: { $lt: cutoffDate }
    });

    res.json({
      success: true,
      retentionDays: RETENTION_DAYS,
      cutoffDate: cutoffDate.toISOString(),
      oldRecordsCounts: {
        clonedEmails: clonedEmailsCount,
        createdLists: createdListsCount,
        total: clonedEmailsCount + createdListsCount
      },
      message: `${clonedEmailsCount + createdListsCount} records are older than ${RETENTION_DAYS} days and will be deleted on cleanup`
    });
  } catch (err) {
    console.error("[Data Retention] Status check failed:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ✔️ API - Get all emails for cleanup page (protected)
router.get('/api/emails', ensureAuthenticated, async (req, res) => {
  try {
    // Fetch cloned emails instead of segmentations
    const clonedEmails = await ClonedEmail.find().sort({ createdAt: -1 }).lean();

    const formattedEmails = clonedEmails.map(email => ({
      id: email._id,
      clonedEmailId: email.clonedEmailId,
      name: email.clonedEmailName || 'No Name',
      scheduledTime: email.scheduledTime,
      status: email.status,
      date: email.createdAt ? new Date(email.createdAt).toLocaleDateString() : '',
      createdAt: email.createdAt
    }));

    res.json(formattedEmails);
  } catch (err) {
    console.error("Error fetching emails:", err);
    res.status(500).json({ success: false, message: "Failed to fetch emails" });
  }
});

// ✔️ API - Get all lists for cleanup page (protected)
router.get('/api/lists', ensureAuthenticated, async (req, res) => {
  try {
    const lists = await CreatedList.find().sort({ createdDate: -1 }).lean();

    const formattedLists = lists.map(list => ({
      id: list._id,
      name: list.name || 'Unnamed List',
      listId: list.listId,
      date: list.createdDate ? new Date(list.createdDate).toLocaleDateString() : '',
      createdDate: list.createdDate
    }));

    res.json(formattedLists);
  } catch (err) {
    console.error("Error fetching lists:", err);
    res.status(500).json({ success: false, message: "Failed to fetch lists" });
  }
});

// ✔️ API - Delete multiple emails (protected)
router.post('/api/emails/delete', ensureAuthenticated, async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "No email IDs provided" });
    }

    console.log(`\n[Email Deletion] Starting deletion of ${ids.length} cloned email(s) by user: ${req.session.user}`);

    let deletedCount = 0;
    let errors = [];

    for (const id of ids) {
      try {
        // Get the cloned email from MongoDB
        const clonedEmail = await ClonedEmail.findById(id);

        if (clonedEmail) {
          // Delete from HubSpot first
          try {
            await axios.delete(
              `https://api.hubapi.com/marketing/v3/emails/${clonedEmail.clonedEmailId}`,
              { headers: hubspotHeaders }
            );
            console.log(`  ✓ Deleted cloned email from HubSpot: ${clonedEmail.clonedEmailId} (${clonedEmail.clonedEmailName})`);
          } catch (hubspotErr) {
            console.error(`  ⚠️  Failed to delete email ${clonedEmail.clonedEmailId} from HubSpot:`, hubspotErr.response?.status);
            // Continue with MongoDB deletion even if HubSpot deletion fails
          }

          // Delete from MongoDB
          await ClonedEmail.findByIdAndDelete(id);
          console.log(`  ✓ Deleted cloned email from MongoDB: ${id}`);
          deletedCount++;
        } else {
          console.log(`  ⚠️  Cloned email not found: ${id}`);
          errors.push({ id, error: "Cloned email not found" });
        }
      } catch (err) {
        console.error(`  ❌ Error deleting email ${id}:`, err.message);
        errors.push({ id, error: err.message });
      }

      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`[Email Deletion] Completed: ${deletedCount}/${ids.length} deleted successfully\n`);

    res.json({
      success: true,
      message: `Successfully deleted ${deletedCount} email(s)`,
      deletedCount: deletedCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error("Error deleting emails:", err);
    res.status(500).json({ success: false, message: "Failed to delete emails", error: err.message });
  }
});

// ✔️ API - Delete multiple lists (protected)
router.post('/api/lists/delete', ensureAuthenticated, async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "No list IDs provided" });
    }

    console.log(`\n[List Deletion] Starting deletion of ${ids.length} list(s) by user: ${req.session.user}`);

    let deletedCount = 0;
    let errors = [];

    for (const id of ids) {
      try {
        // Get the list from MongoDB
        const list = await CreatedList.findById(id);

        if (list && list.listId) {
          // Delete from HubSpot first
          try {
            await axios.delete(
              `https://api.hubapi.com/crm/v3/lists/${list.listId}`,
              { headers: hubspotHeaders }
            );
            console.log(`  ✓ Deleted list from HubSpot: ${list.listId} (${list.name})`);
          } catch (hubspotErr) {
            console.error(`  ⚠️  Failed to delete list ${list.listId} from HubSpot:`, hubspotErr.response?.status);
            // Continue with MongoDB deletion even if HubSpot deletion fails
          }

          // Delete from MongoDB
          await CreatedList.findByIdAndDelete(id);
          console.log(`  ✓ Deleted list from MongoDB: ${id}`);
          deletedCount++;
        } else {
          console.log(`  ⚠️  List not found or missing listId: ${id}`);
          errors.push({ id, error: "List not found or missing listId" });
        }
      } catch (err) {
        console.error(`  ❌ Error deleting list ${id}:`, err.message);
        errors.push({ id, error: err.message });
      }

      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`[List Deletion] Completed: ${deletedCount}/${ids.length} deleted successfully\n`);

    res.json({
      success: true,
      message: `Successfully deleted ${deletedCount} list(s)`,
      deletedCount: deletedCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error("Error deleting lists:", err);
    res.status(500).json({ success: false, message: "Failed to delete lists", error: err.message });
  }
});

// ✔️ BATCH FIX LEGACY IDs - Fix all incorrect legacy IDs in database (protected)
router.post('/fix-all-legacy-ids', ensureAuthenticated, async (req, res) => {
  try {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🔧 BATCH LEGACY ID FIX STARTED');
    console.log(`   Triggered by: ${req.session.user}`);
    console.log('═══════════════════════════════════════════════════════════');

    // Fetch all lists from database
    const allLists = await CreatedList.find({}).lean();
    console.log(`📋 Found ${allLists.length} lists in database\n`);

    if (allLists.length === 0) {
      return res.json({
        success: true,
        message: 'No lists to process',
        stats: { total: 0, fixed: 0, alreadyCorrect: 0, errors: 0 }
      });
    }

    // Statistics
    let totalProcessed = 0;
    let totalFixed = 0;
    let totalAlreadyCorrect = 0;
    let totalErrors = 0;
    const fixedLists = [];
    const errorLists = [];

    // Helper function to fetch legacy ID from HubSpot
    const getLegacyIdFromHubSpot = async (ilsListId) => {
      try {
        const searchResponse = await axios.post(
          `https://api.hubapi.com/crm/v3/lists/search`,
          {
            listIds: [String(ilsListId)],
            additionalProperties: ["hs_classic_list_id"]
          },
          { headers: hubspotHeaders }
        );

        if (searchResponse.data?.lists?.length > 0) {
          const legacyId = searchResponse.data.lists[0].additionalProperties?.hs_classic_list_id;
          return legacyId || null;
        }
        return null;
      } catch (error) {
        console.error(`  ❌ API error for ILS ID ${ilsListId}:`, error.response?.status || error.message);
        return null;
      }
    };

    // Process each list
    for (const list of allLists) {
      totalProcessed++;
      const ilsListId = list.listId;
      const currentLegacyId = list.legacyListId;

      console.log(`\n[${totalProcessed}/${allLists.length}] ${list.name}`);
      console.log(`  ILS ID: ${ilsListId}, Current legacy ID: ${currentLegacyId || 'NULL'}`);

      // Check if current legacy ID is same as ILS ID (this is WRONG!)
      const isWrong = currentLegacyId && (
        String(currentLegacyId) === String(ilsListId) ||
        parseInt(currentLegacyId) === parseInt(ilsListId)
      );

      if (isWrong) {
        console.log(`  ⚠️  Database has ILS ID as legacy ID - INCORRECT!`);
      }

      // Fetch correct legacy ID from HubSpot
      const correctLegacyId = await getLegacyIdFromHubSpot(ilsListId);

      if (!correctLegacyId) {
        console.log(`  ❌ Could not fetch legacy ID from HubSpot`);
        totalErrors++;
        errorLists.push({
          name: list.name,
          ilsId: ilsListId,
          reason: 'HubSpot API failed'
        });

        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      // Check if we need to update
      if (String(currentLegacyId) === String(correctLegacyId)) {
        console.log(`  ✓  Already correct`);
        totalAlreadyCorrect++;
      } else {
        console.log(`  🔧 Updating: ${currentLegacyId || 'NULL'} → ${correctLegacyId}`);

        await CreatedList.updateOne(
          { _id: list._id },
          { $set: { legacyListId: correctLegacyId } }
        );

        console.log(`  ✅ Updated!`);
        totalFixed++;
        fixedLists.push({
          name: list.name,
          ilsId: ilsListId,
          oldLegacyId: currentLegacyId,
          newLegacyId: correctLegacyId
        });
      }

      // Add delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Print summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 BATCH FIX SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Total Lists Processed:     ${totalProcessed}`);
    console.log(`✅ Already Correct:         ${totalAlreadyCorrect}`);
    console.log(`🔧 Fixed:                   ${totalFixed}`);
    console.log(`❌ Errors:                  ${totalErrors}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    res.json({
      success: true,
      message: `Batch fix completed: ${totalFixed} lists updated, ${totalAlreadyCorrect} already correct, ${totalErrors} errors`,
      stats: {
        total: totalProcessed,
        fixed: totalFixed,
        alreadyCorrect: totalAlreadyCorrect,
        errors: totalErrors
      },
      fixedLists: fixedLists,
      errorLists: errorLists
    });

  } catch (err) {
    console.error('\n❌ Batch fix failed:', err);
    res.status(500).json({
      success: false,
      message: 'Batch fix failed',
      error: err.message
    });
  }
});

module.exports = router;
