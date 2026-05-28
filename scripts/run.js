require("dotenv").config();

const updateExisting = require("./updateExisting");
const importNew = require("./importNew");

async function run() {
  console.log("\n==============================");
  console.log("STEP 1: UPDATE EXISTING BOOKS");
  console.log("==============================\n");
  await updateExisting();

  console.log("\n===========================");
  console.log("STEP 2: IMPORT MODERN BOOKS");
  console.log("===========================\n");
  await importNew();

  console.log("\n==================");
  console.log("SYNC ALL COMPLETE");
  console.log("==================\n");
}

if (require.main === module) {
  run().catch((error) => {
    console.error("[run] Fatal:", error);
    process.exit(1);
  });
}

module.exports = run;
