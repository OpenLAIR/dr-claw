import { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Plus, Trash2, Edit3, Check, X, ToggleLeft, ToggleRight } from 'lucide-react';
import { authenticatedFetch } from '../../utils/api';

const CATEGORIES = [
  { value: 'general', label: 'General', color: 'bg-gray-500' },
  { value: 'preference', label: 'Preference', color: 'bg-blue-500' },
  { value: 'context', label: 'Context', color: 'bg-green-500' },
  { value: 'workflow', label: 'Workflow', color: 'bg-purple-500' },
];

function MemoryContent() {
  const [memories, setMemories] = useState([]);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('general');
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState('general');

  const fetchMemories = useCallback(async () => {
    try {
      const [memoriesRes, settingsRes] = await Promise.all([
        authenticatedFetch('/api/memory'),
        authenticatedFetch('/api/memory/settings'),
      ]);
      if (memoriesRes.ok) {
        const data = await memoriesRes.json();
        setMemories(data.memories || []);
      }
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setGlobalEnabled(data.enabled);
      }
    } catch (err) {
      console.error('Failed to fetch memories:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const handleCreate = async () => {
    if (!newContent.trim()) return;
    try {
      const res = await authenticatedFetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent.trim(), category: newCategory }),
      });
      if (res.ok) {
        const data = await res.json();
        setMemories(prev => [data.memory, ...prev]);
        setNewContent('');
        setNewCategory('general');
      }
    } catch (err) {
      console.error('Failed to create memory:', err);
    }
  };

  const handleUpdate = async (id) => {
    try {
      const res = await authenticatedFetch(`/api/memory/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent.trim(), category: editCategory }),
      });
      if (res.ok) {
        const data = await res.json();
        setMemories(prev => prev.map(m => m.id === id ? data.memory : m));
        setEditingId(null);
      }
    } catch (err) {
      console.error('Failed to update memory:', err);
    }
  };

  const handleToggle = async (id) => {
    try {
      const res = await authenticatedFetch(`/api/memory/${id}/toggle`, { method: 'PATCH' });
      if (res.ok) {
        const data = await res.json();
        setMemories(prev => prev.map(m => m.id === id ? data.memory : m));
      }
    } catch (err) {
      console.error('Failed to toggle memory:', err);
    }
  };

  const handleDelete = async (id) => {
    try {
      const res = await authenticatedFetch(`/api/memory/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setMemories(prev => prev.filter(m => m.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete memory:', err);
    }
  };

  const handleGlobalToggle = async () => {
    try {
      const res = await authenticatedFetch('/api/memory/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !globalEnabled }),
      });
      if (res.ok) {
        setGlobalEnabled(!globalEnabled);
      }
    } catch (err) {
      console.error('Failed to toggle global memory:', err);
    }
  };

  const startEdit = (memory) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
    setEditCategory(memory.category || 'general');
  };

  const getCategoryConfig = (cat) => CATEGORIES.find(c => c.value === cat) || CATEGORIES[0];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        Loading memories...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with global toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-foreground">Memory</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Save preferences and context that AI agents will remember across conversations.
          </p>
        </div>
        <button
          onClick={handleGlobalToggle}
          className="flex items-center gap-2 text-sm font-medium"
          title={globalEnabled ? 'Disable memory' : 'Enable memory'}
        >
          {globalEnabled ? (
            <ToggleRight className="w-8 h-8 text-blue-600" />
          ) : (
            <ToggleLeft className="w-8 h-8 text-gray-400" />
          )}
        </button>
      </div>

      {!globalEnabled && (
        <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-3 text-sm text-yellow-800 dark:text-yellow-200">
          Memory is currently disabled. AI agents will not use saved memories.
        </div>
      )}

      {/* Add new memory */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-medium text-foreground">Add Memory</h4>
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder="e.g., I prefer Python for data analysis, My name is Henry, I'm working on NLP research..."
          className="w-full min-h-[80px] px-3 py-2 text-sm rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />
        <div className="flex items-center gap-3">
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!newContent.trim()}
            className="gap-1"
          >
            <Plus className="w-4 h-4" />
            Add
          </Button>
        </div>
      </div>

      {/* Memory list */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">
          Saved Memories ({memories.length})
        </h4>
        {memories.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No memories saved yet. Add one above to get started.
          </p>
        ) : (
          <div className="space-y-2">
            {memories.map(memory => (
              <div
                key={memory.id}
                className={`border border-border rounded-lg p-3 transition-colors ${
                  !memory.is_enabled ? 'opacity-50' : ''
                }`}
              >
                {editingId === memory.id ? (
                  /* Edit mode */
                  <div className="space-y-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full min-h-[60px] px-3 py-2 text-sm rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                    />
                    <div className="flex items-center gap-2">
                      <select
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        className="px-2 py-1 text-xs rounded-md border border-input bg-background text-foreground"
                      >
                        {CATEGORIES.map(cat => (
                          <option key={cat.value} value={cat.value}>{cat.label}</option>
                        ))}
                      </select>
                      <Button size="sm" variant="ghost" onClick={() => handleUpdate(memory.id)}>
                        <Check className="w-4 h-4 text-green-600" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        <X className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Display mode */
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">{memory.content}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge variant="secondary" className="text-xs">
                          <span className={`w-2 h-2 rounded-full ${getCategoryConfig(memory.category).color} inline-block mr-1`} />
                          {getCategoryConfig(memory.category).label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(memory.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleToggle(memory.id)}
                        className="p-1 rounded hover:bg-accent"
                        title={memory.is_enabled ? 'Disable' : 'Enable'}
                      >
                        {memory.is_enabled ? (
                          <ToggleRight className="w-5 h-5 text-blue-600" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-gray-400" />
                        )}
                      </button>
                      <button
                        onClick={() => startEdit(memory)}
                        className="p-1 rounded hover:bg-accent"
                        title="Edit"
                      >
                        <Edit3 className="w-4 h-4 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => handleDelete(memory.id)}
                        className="p-1 rounded hover:bg-accent"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MemoryContent;
