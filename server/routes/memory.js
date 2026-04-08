import express from 'express';
import { memoryDb, appSettingsDb } from '../database/db.js';

const router = express.Router();
const MEMORY_ENABLED_KEY = 'memory_enabled';

// ===============================
// Memory CRUD
// ===============================

// Get all memories for the authenticated user
router.get('/', async (req, res) => {
  try {
    const memories = memoryDb.getAll(req.user.id);
    res.json({ memories });
  } catch (error) {
    console.error('Error fetching memories:', error);
    res.status(500).json({ error: 'Failed to fetch memories' });
  }
});

// Create a new memory
router.post('/', async (req, res) => {
  try {
    const { content, category } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Memory content is required' });
    }
    const memory = memoryDb.create(req.user.id, content.trim(), category || 'general');
    res.status(201).json({ memory });
  } catch (error) {
    console.error('Error creating memory:', error);
    res.status(500).json({ error: 'Failed to create memory' });
  }
});

// Update a memory
router.put('/:id', async (req, res) => {
  try {
    const { content, category } = req.body;
    const memory = memoryDb.update(req.user.id, req.params.id, {
      content: content?.trim(),
      category,
    });
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }
    res.json({ memory });
  } catch (error) {
    console.error('Error updating memory:', error);
    res.status(500).json({ error: 'Failed to update memory' });
  }
});

// Toggle memory enabled/disabled
router.patch('/:id/toggle', async (req, res) => {
  try {
    const memory = memoryDb.toggle(req.user.id, req.params.id);
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }
    res.json({ memory });
  } catch (error) {
    console.error('Error toggling memory:', error);
    res.status(500).json({ error: 'Failed to toggle memory' });
  }
});

// Delete a memory
router.delete('/:id', async (req, res) => {
  try {
    const deleted = memoryDb.delete(req.user.id, req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Memory not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting memory:', error);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

// ===============================
// Global Memory Settings
// ===============================

// Get global memory enabled state
router.get('/settings', async (req, res) => {
  try {
    const value = appSettingsDb.get(MEMORY_ENABLED_KEY);
    res.json({ enabled: value !== 'false' }); // default to true
  } catch (error) {
    console.error('Error fetching memory settings:', error);
    res.status(500).json({ error: 'Failed to fetch memory settings' });
  }
});

// Set global memory enabled state
router.patch('/settings', async (req, res) => {
  try {
    const { enabled } = req.body;
    appSettingsDb.set(MEMORY_ENABLED_KEY, enabled ? 'true' : 'false');
    res.json({ enabled: !!enabled });
  } catch (error) {
    console.error('Error updating memory settings:', error);
    res.status(500).json({ error: 'Failed to update memory settings' });
  }
});

export default router;
