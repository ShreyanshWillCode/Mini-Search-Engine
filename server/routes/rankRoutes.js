"use strict";

const express = require("express");
const { calculatePageRank } = require("../controllers/rankController");

const router = express.Router();

router.post("/pagerank", calculatePageRank);

module.exports = router;
