'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

async function jsonRequest(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return data
}

const EMPTY_SCENARIO = {
  category_slug: '',
  category_name_zh: '',
  category_name_en: '',
  category_name_ja: '',
  category_icon: '',
  category_sort: 0,
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
}

function scenarioForCategory(category) {
  return {
    ...EMPTY_SCENARIO,
    category_slug: category?.slug || '',
    category_name_zh: category?.name_zh || '',
    category_name_en: category?.name_en || '',
    category_name_ja: category?.name_ja || '',
    category_icon: category?.icon || '',
    category_sort: category?.sort_order || 0,
  }
}

export default function AdminScenariosPage() {
  const [categories, setCategories] = useState([])
  const [scenarios, setScenarios] = useState([])
  const [selectedCategorySlug, setSelectedCategorySlug] = useState(null)
  const [editingScenario, setEditingScenario] = useState(null)
  const [loading, setLoading] = useState(true)
  const [scenariosLoading, setScenariosLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [message, setMessage] = useState('')
  const scenariosRequestVersionRef = useRef(0)

  const handleError = useCallback((error) => {
    if (error?.status === 403) setForbidden(true)
    setMessage(error?.message || 'Unexpected error')
  }, [])

  const loadCategories = useCallback(async (preferredSlug) => {
    try {
      const result = await jsonRequest('/api/admin/scenarios?categories=true')
      const nextCategories = Array.isArray(result.data) ? result.data : []
      setCategories(nextCategories)
      setSelectedCategorySlug((current) => {
        const candidate = preferredSlug || current
        return nextCategories.some((category) => category.slug === candidate)
          ? candidate
          : nextCategories[0]?.slug || null
      })
    } catch (error) {
      handleError(error)
    } finally {
      setLoading(false)
    }
  }, [handleError])

  const loadScenarios = useCallback(async (categorySlug) => {
    const requestVersion = ++scenariosRequestVersionRef.current
    setScenarios([])
    if (!categorySlug) {
      setScenariosLoading(false)
      return
    }
    setScenariosLoading(true)
    try {
      const result = await jsonRequest(`/api/admin/scenarios?categorySlug=${encodeURIComponent(categorySlug)}`)
      if (scenariosRequestVersionRef.current === requestVersion) {
        setScenarios(Array.isArray(result.data) ? result.data : [])
      }
    } catch (error) {
      if (scenariosRequestVersionRef.current === requestVersion) handleError(error)
    } finally {
      if (scenariosRequestVersionRef.current === requestVersion) setScenariosLoading(false)
    }
  }, [handleError])

  useEffect(() => { loadCategories() }, [loadCategories])
  useEffect(() => { loadScenarios(selectedCategorySlug) }, [selectedCategorySlug, loadScenarios])

  const saveScenario = async () => {
    if (!editingScenario || saving) return
    setSaving(true)
    try {
      const method = editingScenario.id ? 'PUT' : 'POST'
      const result = await jsonRequest('/api/admin/scenarios', method, editingScenario)
      const savedSlug = result.data?.category_slug || editingScenario.category_slug
      setEditingScenario(null)
      setMessage('Saved')
      await loadCategories(savedSlug)
      await loadScenarios(savedSlug)
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  const deleteScenario = async (scenario) => {
    if (!window.confirm(`Delete “${scenario.title_en}”?`)) return
    try {
      await jsonRequest(`/api/admin/scenarios?id=${encodeURIComponent(scenario.id)}`, 'DELETE')
      setMessage('Deleted')
      await loadScenarios(selectedCategorySlug)
      await loadCategories(selectedCategorySlug)
    } catch (error) {
      handleError(error)
    }
  }

  if (loading) return <div className="p-8 text-foreground">Loading...</div>
  if (forbidden) return <div className="p-8 text-red-500 text-lg">Access denied</div>

  const selectedCategory = categories.find((category) => category.slug === selectedCategorySlug)

  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Scenario Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Categories are embedded in system scenarios. Create the first scenario to create a category.
          </p>
        </div>
        <button
          onClick={() => setEditingScenario(scenarioForCategory(null))}
          className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm"
        >
          + New category & scenario
        </button>
      </div>

      {message && (
        <div className="border border-border bg-card px-3 py-2 rounded mb-4 text-sm">{message}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        <section className="border border-border rounded-lg p-4 bg-card">
          <h2 className="font-semibold text-lg mb-3">Categories</h2>
          <div className="space-y-1">
            {categories.map((category) => (
              <button
                key={category.slug}
                onClick={() => setSelectedCategorySlug(category.slug)}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  selectedCategorySlug === category.slug ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                }`}
              >
                <span className="mr-1">{category.icon || '💬'}</span>
                {category.name_zh || category.name_en || category.slug}
                <span className="block text-xs text-muted-foreground mt-0.5">{category.slug}</span>
              </button>
            ))}
            {categories.length === 0 && <p className="text-muted-foreground text-sm">No system categories</p>}
          </div>
        </section>

        <section className="border border-border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="font-semibold text-lg">
              {selectedCategory ? `${selectedCategory.icon || ''} ${selectedCategory.name_en || selectedCategory.slug}` : 'Scenarios'}
            </h2>
            {selectedCategory && (
              <button
                onClick={() => setEditingScenario(scenarioForCategory(selectedCategory))}
                className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm"
              >
                + Add scenario
              </button>
            )}
          </div>

          <div className="space-y-2">
            {scenarios.map((scenario) => (
              <article key={scenario.id} className="flex items-start justify-between gap-3 border border-border rounded p-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{scenario.title_zh} / {scenario.title_en}</div>
                  <div className="text-muted-foreground text-xs mt-1">
                    {scenario.difficulty} · {scenario.is_active ? 'Active' : 'Inactive'} · order {scenario.sort_order}
                  </div>
                  {scenario.description_en && <p className="text-muted-foreground text-xs mt-1 line-clamp-2">{scenario.description_en}</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => setEditingScenario({ ...scenario })} className="text-xs hover:underline">Edit</button>
                  <button onClick={() => deleteScenario(scenario)} className="text-xs text-red-400 hover:underline">Delete</button>
                </div>
              </article>
            ))}
            {scenariosLoading && <p className="text-muted-foreground text-sm py-6 text-center">Loading scenarios...</p>}
            {selectedCategory && !scenariosLoading && scenarios.length === 0 && <p className="text-muted-foreground text-sm py-6 text-center">No scenarios</p>}
            {!selectedCategory && <p className="text-muted-foreground text-sm py-6 text-center">Create or select a category</p>}
          </div>
        </section>
      </div>

      {editingScenario && (
        <ScenarioModal
          scenario={editingScenario}
          setScenario={setEditingScenario}
          onClose={() => setEditingScenario(null)}
          onSave={saveScenario}
          saving={saving}
        />
      )}
    </main>
  )
}

function ScenarioModal({ scenario, setScenario, onClose, onSave, saving }) {
  const set = (field, value) => setScenario((current) => ({ ...current, [field]: value }))
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">{scenario.id ? 'Edit scenario' : 'New scenario'}</h3>

        <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3 border border-border rounded p-3 mb-4">
          <legend className="text-sm font-medium px-1">Embedded category</legend>
          <Field label="Slug" value={scenario.category_slug} onChange={(value) => set('category_slug', value)} placeholder="daily_life" />
          <Field label="Icon" value={scenario.category_icon || ''} onChange={(value) => set('category_icon', value)} placeholder="🏠" />
          <Field label="Name (ZH)" value={scenario.category_name_zh || ''} onChange={(value) => set('category_name_zh', value)} />
          <Field label="Name (EN)" value={scenario.category_name_en || ''} onChange={(value) => set('category_name_en', value)} />
          <Field label="Name (JA)" value={scenario.category_name_ja || ''} onChange={(value) => set('category_name_ja', value)} />
          <Field label="Category order" type="number" value={scenario.category_sort ?? 0} onChange={(value) => set('category_sort', Number(value))} />
        </fieldset>

        <div className="space-y-3">
          <Field label="Title (ZH)" value={scenario.title_zh} onChange={(value) => set('title_zh', value)} />
          <Field label="Title (EN)" value={scenario.title_en} onChange={(value) => set('title_en', value)} />
          <Field label="Title (JA)" value={scenario.title_ja || ''} onChange={(value) => set('title_ja', value)} />
          <Field label="Description (ZH)" value={scenario.description_zh || ''} onChange={(value) => set('description_zh', value)} multiline />
          <Field label="Description (EN)" value={scenario.description_en || ''} onChange={(value) => set('description_en', value)} multiline />
          <Field label="Description (JA)" value={scenario.description_ja || ''} onChange={(value) => set('description_ja', value)} multiline />

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-muted-foreground">
              Difficulty
              <select value={scenario.difficulty} onChange={(event) => set('difficulty', event.target.value)} className="mt-1 w-full px-3 py-2 rounded bg-background border border-input text-foreground text-sm">
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
            <Field label="Scenario order" type="number" value={scenario.sort_order ?? 0} onChange={(value) => set('sort_order', Number(value))} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={scenario.is_active !== false} onChange={(event) => set('is_active', event.target.checked)} />
            Active
          </label>

          <label className="text-xs text-muted-foreground block">
            System prompt
            <textarea value={scenario.system_prompt} onChange={(event) => set('system_prompt', event.target.value)} className="mt-1 w-full px-3 py-2 rounded bg-background border border-input text-foreground text-sm min-h-36" />
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded text-sm bg-secondary text-secondary-foreground disabled:opacity-50">Cancel</button>
          <button onClick={onSave} disabled={saving} className="px-4 py-2 rounded text-sm bg-primary text-primary-foreground disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', multiline = false }) {
  const className = 'mt-1 w-full px-3 py-2 rounded bg-background border border-input text-foreground text-sm'
  return (
    <label className="text-xs text-muted-foreground block">
      {label}
      {multiline ? (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} className={`${className} min-h-20`} placeholder={placeholder} />
      ) : (
        <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className={className} placeholder={placeholder} />
      )}
    </label>
  )
}
