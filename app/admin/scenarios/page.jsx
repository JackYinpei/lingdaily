'use client';

import { useEffect, useState, useCallback } from 'react';

function jsonReq(url, method, body) {
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  });
}

const emptyCategory = { slug: '', name_zh: '', name_en: '', name_ja: '', icon: '', sort_order: 0 };
const emptyScenario = {
  category_id: '',
  title_zh: '',
  title_en: '',
  title_ja: '',
  description_zh: '',
  description_en: '',
  description_ja: '',
  difficulty: 'intermediate',
  system_prompt: '',
  sort_order: 0,
  is_active: true,
};

export default function AdminScenariosPage() {
  const [forbidden, setForbidden] = useState(false);
  const [categories, setCategories] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [selectedCatId, setSelectedCatId] = useState(null);
  const [editingCat, setEditingCat] = useState(null); // null | object
  const [editingScenario, setEditingScenario] = useState(null); // null | object
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  // Fetch categories
  const loadCategories = useCallback(async () => {
    try {
      const j = await jsonReq('/api/scenarios?categories=true', 'GET');
      setCategories(j.data || []);
    } catch (e) {
      if (e.message.includes('403') || e.message.includes('Forbidden')) {
        setForbidden(true);
      }
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch scenarios for selected category (admin endpoint includes inactive)
  const loadScenarios = useCallback(async (catId) => {
    if (!catId) { setScenarios([]); return; }
    try {
      const j = await jsonReq(`/api/admin/scenarios?categoryId=${catId}`, 'GET');
      setScenarios(j.data || []);
    } catch (e) {
      if (e.message.includes('403') || e.message.includes('Forbidden')) setForbidden(true);
      setMsg(e.message);
    }
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadScenarios(selectedCatId); }, [selectedCatId, loadScenarios]);

  // ---- Category CRUD ----
  const saveCategory = async () => {
    if (!editingCat) return;
    try {
      if (editingCat.id) {
        await jsonReq('/api/admin/scenario-categories', 'PUT', editingCat);
      } else {
        await jsonReq('/api/admin/scenario-categories', 'POST', editingCat);
      }
      setEditingCat(null);
      setMsg('');
      await loadCategories();
    } catch (e) { setMsg(e.message); }
  };

  const deleteCategory = async (id) => {
    if (!confirm('Delete this category and all its scenarios?')) return;
    try {
      await jsonReq(`/api/admin/scenario-categories?id=${id}`, 'DELETE');
      if (selectedCatId === id) { setSelectedCatId(null); setScenarios([]); }
      await loadCategories();
    } catch (e) { setMsg(e.message); }
  };

  // ---- Scenario CRUD ----
  const saveScenario = async () => {
    if (!editingScenario) return;
    try {
      if (editingScenario.id) {
        await jsonReq('/api/admin/scenarios', 'PUT', editingScenario);
      } else {
        await jsonReq('/api/admin/scenarios', 'POST', editingScenario);
      }
      setEditingScenario(null);
      setMsg('');
      await loadScenarios(selectedCatId);
    } catch (e) { setMsg(e.message); }
  };

  const deleteScenario = async (id) => {
    if (!confirm('Delete this scenario?')) return;
    try {
      await jsonReq(`/api/admin/scenarios?id=${id}`, 'DELETE');
      await loadScenarios(selectedCatId);
    } catch (e) { setMsg(e.message); }
  };

  if (loading) return <div className="p-8 text-foreground">Loading...</div>;
  if (forbidden) return <div className="p-8 text-red-500 text-lg">Access Denied</div>;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Scenario Admin</h1>
      {msg && <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-2 rounded mb-4 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Categories panel */}
        <div className="border border-border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-lg">Categories</h2>
            <button
              onClick={() => setEditingCat({ ...emptyCategory })}
              className="text-sm px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
            >
              + Add
            </button>
          </div>

          <div className="space-y-1">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer text-sm ${
                  selectedCatId === cat.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                }`}
                onClick={() => setSelectedCatId(cat.id)}
              >
                <span>{cat.icon ? `${cat.icon} ` : ''}{cat.name_zh} / {cat.name_en}</span>
                <div className="flex gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingCat({ ...cat }); }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Edit
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteCategory(cat.id); }}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Del
                  </button>
                </div>
              </div>
            ))}
            {categories.length === 0 && <p className="text-muted-foreground text-sm">No categories</p>}
          </div>
        </div>

        {/* Scenarios panel */}
        <div className="border border-border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-lg">
              Scenarios {selectedCatId ? `(${categories.find((c) => c.id === selectedCatId)?.name_en || ''})` : ''}
            </h2>
            {selectedCatId && (
              <button
                onClick={() => setEditingScenario({ ...emptyScenario, category_id: selectedCatId })}
                className="text-sm px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                + Add
              </button>
            )}
          </div>

          {!selectedCatId ? (
            <p className="text-muted-foreground text-sm">Select a category</p>
          ) : scenarios.length === 0 ? (
            <p className="text-muted-foreground text-sm">No scenarios in this category</p>
          ) : (
            <div className="space-y-2">
              {scenarios.map((s) => (
                <div key={s.id} className="flex items-start justify-between border border-border rounded p-3 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{s.title_zh} / {s.title_en}</div>
                    <div className="text-muted-foreground text-xs mt-1">
                      {s.difficulty} · {s.is_active ? 'Active' : 'Inactive'} · order: {s.sort_order}
                    </div>
                    {s.description_en && (
                      <div className="text-muted-foreground text-xs mt-1 line-clamp-2">{s.description_en}</div>
                    )}
                  </div>
                  <div className="flex gap-1 ml-2 flex-shrink-0">
                    <button
                      onClick={() => setEditingScenario({ ...s })}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteScenario(s.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Del
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category Edit Modal */}
      {editingCat && (
        <Modal title={editingCat.id ? 'Edit Category' : 'New Category'} onClose={() => setEditingCat(null)} onSave={saveCategory}>
          <Field label="Slug" value={editingCat.slug} onChange={(v) => setEditingCat({ ...editingCat, slug: v })} placeholder="study_abroad_interview" />
          <Field label="Name (ZH)" value={editingCat.name_zh} onChange={(v) => setEditingCat({ ...editingCat, name_zh: v })} />
          <Field label="Name (EN)" value={editingCat.name_en} onChange={(v) => setEditingCat({ ...editingCat, name_en: v })} />
          <Field label="Name (JA)" value={editingCat.name_ja || ''} onChange={(v) => setEditingCat({ ...editingCat, name_ja: v })} />
          <Field label="Icon (emoji)" value={editingCat.icon || ''} onChange={(v) => setEditingCat({ ...editingCat, icon: v })} placeholder="🎓" />
          <Field label="Sort Order" type="number" value={editingCat.sort_order} onChange={(v) => setEditingCat({ ...editingCat, sort_order: Number(v) })} />
        </Modal>
      )}

      {/* Scenario Edit Modal */}
      {editingScenario && (
        <Modal title={editingScenario.id ? 'Edit Scenario' : 'New Scenario'} onClose={() => setEditingScenario(null)} onSave={saveScenario}>
          <Field label="Title (ZH)" value={editingScenario.title_zh} onChange={(v) => setEditingScenario({ ...editingScenario, title_zh: v })} />
          <Field label="Title (EN)" value={editingScenario.title_en} onChange={(v) => setEditingScenario({ ...editingScenario, title_en: v })} />
          <Field label="Title (JA)" value={editingScenario.title_ja || ''} onChange={(v) => setEditingScenario({ ...editingScenario, title_ja: v })} />
          <Field label="Description (ZH)" value={editingScenario.description_zh || ''} onChange={(v) => setEditingScenario({ ...editingScenario, description_zh: v })} multiline />
          <Field label="Description (EN)" value={editingScenario.description_en || ''} onChange={(v) => setEditingScenario({ ...editingScenario, description_en: v })} multiline />
          <Field label="Description (JA)" value={editingScenario.description_ja || ''} onChange={(v) => setEditingScenario({ ...editingScenario, description_ja: v })} multiline />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Difficulty</label>
              <select
                value={editingScenario.difficulty}
                onChange={(e) => setEditingScenario({ ...editingScenario, difficulty: e.target.value })}
                className="w-full px-3 py-2 rounded bg-background border border-input text-foreground text-sm"
              >
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
            <Field label="Sort Order" type="number" value={editingScenario.sort_order} onChange={(v) => setEditingScenario({ ...editingScenario, sort_order: Number(v) })} />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={editingScenario.is_active}
              onChange={(e) => setEditingScenario({ ...editingScenario, is_active: e.target.checked })}
              className="rounded"
            />
            <label className="text-sm text-foreground">Active</label>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">System Prompt (instructions for AI)</label>
            <textarea
              value={editingScenario.system_prompt}
              onChange={(e) => setEditingScenario({ ...editingScenario, system_prompt: e.target.value })}
              className="w-full px-3 py-2 rounded bg-background border border-input text-foreground text-sm min-h-[120px]"
              placeholder="You are an admissions interviewer at Cambridge University..."
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, onSave, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
        <div className="space-y-3">{children}</div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80">
            Cancel
          </button>
          <button onClick={onSave} className="px-4 py-2 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', multiline = false }) {
  const cls = "w-full px-3 py-2 rounded bg-background border border-input text-foreground text-sm";
  return (
    <div>
      <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} className={`${cls} min-h-[60px]`} placeholder={placeholder} />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={cls} placeholder={placeholder} />
      )}
    </div>
  );
}
