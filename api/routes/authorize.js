const express = require("express");
const router = express.Router();
const { fetchAccessToken } = require("../../common/authenticateRedbooth");

router.get("/", async (req, res) => {
  const accessToken = await fetchAccessToken(null, req.query.code);
  console.log("Access Token in Express Response: ", accessToken);
  res.json(accessToken);
});

module.exports = router;
