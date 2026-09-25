const express = require('express');

const router = express.Router();

// Placeholder route — stats logic comes in a later task.
router.get('/', (req, res) => {
  return res.json({
    success: true,
    message: 'Stats route ready.',
    data: null,
  });
});

module.exports = router;
