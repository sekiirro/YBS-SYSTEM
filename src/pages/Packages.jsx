import React, { useState, useEffect, useMemo } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { PackagesService } from '@/services/packages';
import { WorkspacesService } from '@/services/workspaces';
import { isPlatformAdmin, isWorkspaceOwner, getActiveWorkspaceId } from '@/lib/ybs-auth';
import { PageHeader, LoadingState, EmptyState, Badge, Button, Modal, Input, Select, TextArea } from '@/components/ui';
import { formatCurrency } from '@/lib/ybs-utils';
import SaveStatus from '@/components/SaveStatus';
import useAutosave from '@/hooks/useAutosave';
import { Package as PackageIcon, Plus, Edit, Search, Building2, ChevronUp, ChevronDown, Trash2, Loader2 } from 'lucide-react';

export default function Packages() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [workspaceList, setWorkspaceList] = useState([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [workspacePackages, setWorkspacePackages] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [createScope, setCreateScope] = useState(null);
  const [editingPackage, setEditingPackage] = useState(null);
  const [search, setSearch] = useState('');
  const isAdmin = isPlatformAdmin(user);
  const wsId = getActiveWorkspaceId(user);
  const isOwner = isWorkspaceOwner(user);
  const canManage = isAdmin;
  const canEditPackage = (p) => isAdmin || (isOwner && p.workspace_id === wsId);

  useEffect(() => {
    loadData();
  }, [isAdmin, wsId]);

  useEffect(() => {
    if (isAdmin && selectedWorkspaceId) loadWorkspacePackages(selectedWorkspaceId);
  }, [isAdmin, selectedWorkspaceId]);

  const loadData = async () => {
    try {
      setLoading(true);
      if (isAdmin) {
        // Platform Owner: platform default templates (global) + all workspaces.
        const templatesData = await PackagesService.list();
        setTemplates(templatesData);
        const ws = await WorkspacesService.list().catch(() => []);
        setWorkspaceList(ws);
        if (selectedWorkspaceId && workspaceList.length === 0 && ws.length > 0 && ws.some((w) => w.id === selectedWorkspaceId)) {
          loadWorkspacePackages(selectedWorkspaceId);
        }
      } else if (wsId) {
        // Workspace Owner: ONLY packages owned by the active workspace.
        const data = await PackagesService.list(wsId);
        setPackages(data.filter((p) => p.workspace_id === wsId));
      } else {
        // Coach / trainer without a workspace: read-only default catalog.
        setPackages(await PackagesService.list());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadWorkspacePackages = async (wid) => {
    try {
      const data = await PackagesService.list(wid);
      const own = data.filter((p) => p.workspace_id === wid);
      setWorkspacePackages(own);
      setSelectedWorkspace(workspaceList.find((w) => w.id === wid) || null);
    } catch (err) {
      console.error(err);
    }
  };

  const refresh = async () => {
    await loadData();
    if (isAdmin && selectedWorkspaceId) await loadWorkspacePackages(selectedWorkspaceId);
  };

  const filtered = packages.filter((p) =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <LoadingState label="Loading packages…" />;

  return (
    <div>
      <PageHeader
        title="Packages"
        description={isAdmin
          ? 'Platform default templates & workspace package administration'
          : 'Your Workspace\'s Packages — edit each package\'s name and price'}
        icon={PackageIcon}
        actions={canManage && (
          <Button onClick={() => { setCreateScope({ workspaceId: null }); setShowCreate(true); }}>
            <Plus className="w-4 h-4" /> Create Default Template
          </Button>
        )}
      />

      {isAdmin ? (
        <>
          <div className="mb-2">
            <h2 className="text-sm font-display font-semibold text-foreground">Platform Default Templates</h2>
            <p className="text-[12px] text-muted-foreground">
              Used to seed every workspace with its own package records on creation.
            </p>
          </div>
          {templates.length === 0 ? (
            <EmptyState icon={PackageIcon} title="No default templates" description="Create your first platform default package" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((p) => (
                <PackageCard
                  key={p.id}
                  pkg={p}
                  isTemplate
                  canEdit
                  onEdit={setEditingPackage}
                />
              ))}
            </div>
          )}

          <div className="mt-10 mb-4">
            <h2 className="text-sm font-display font-semibold text-foreground">Workspace Packages</h2>
            <p className="text-[12px] text-muted-foreground">
              Select a workspace to view and manage the packages owned by that workspace.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <div className="relative w-full max-w-xs">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <select
                  value={selectedWorkspaceId}
                  onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                  className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40 appearance-none"
                >
                  <option value="">Select a workspace…</option>
                  {workspaceList.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
              {selectedWorkspaceId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setCreateScope({ workspaceId: selectedWorkspaceId }); setShowCreate(true); }}
                >
                  <Plus className="w-3.5 h-3.5" /> Add Package to Workspace
                </Button>
              )}
            </div>
          </div>
          {!selectedWorkspaceId ? (
            <p className="text-[13px] text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
              Select a workspace above to view and edit its packages.
            </p>
          ) : workspacePackages.length === 0 ? (
            <EmptyState icon={Building2} title="No workspace packages" description={`${selectedWorkspace?.name || 'This workspace'} has no packages yet`} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {workspacePackages.map((p) => (
                <PackageCard
                  key={p.id}
                  pkg={p}
                  canEdit={canEditPackage(p)}
                  onEdit={setEditingPackage}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="relative mb-4 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text" placeholder="Search packages…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
            />
          </div>
          {filtered.length === 0 ? (
            <EmptyState icon={PackageIcon} title="No packages" description="This workspace has no packages yet" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((p) => (
                <PackageCard
                  key={p.id}
                  pkg={p}
                  canEdit={canEditPackage(p)}
                  onEdit={setEditingPackage}
                />
              ))}
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreatePackageModal
          title={createScope?.workspaceId ? 'Add Package to Workspace' : 'Create Default Template'}
          workspaceId={createScope?.workspaceId ?? null}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {editingPackage && (
        <EditPackageModal
          pkg={editingPackage}
          isAdmin={isAdmin}
          onClose={() => setEditingPackage(null)}
          onUpdated={() => { setEditingPackage(null); refresh(); }}
        />
      )}
    </div>
  );
}

function PackageCard({ pkg: p, isTemplate = false, canEdit = false, onEdit }) {
  return (
    <div className="surface-card p-5 transition-all hover:glow-subtle">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-[15px] font-display font-semibold">{p.name}</h3>
          <div className="flex items-center gap-1.5 mt-1">
            <Badge className="text-muted-foreground bg-secondary border-border capitalize">{p.tier}</Badge>
            {isTemplate && (
              <Badge className="text-foreground bg-secondary border-border">Default Template</Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {canEdit && (
            <button
              type="button"
              onClick={() => onEdit(p)}
              className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              title={`Edit ${p.name}`}
            >
              <Edit className="w-3.5 h-3.5" />
            </button>
          )}
          {p.is_active ? (
            <Badge className="text-emerald-400 bg-emerald-500/10 border-emerald-500/20">Active</Badge>
          ) : (
            <Badge className="text-zinc-400 bg-zinc-500/10 border-zinc-500/20">Inactive</Badge>
          )}
        </div>
      </div>
      <p className="text-2xl font-display font-semibold tabular-nums">{formatCurrency(p.price)}</p>
      <p className="text-[12px] text-muted-foreground mt-1">{p.duration} {p.duration_unit}</p>
      {p.description && <p className="text-[12px] text-muted-foreground mt-3">{p.description}</p>}
      {p.features?.length > 0 && (
        <ul className="mt-3 space-y-1">
          {p.features.slice(0, 3).map((f, i) => (
            <li key={i} className="text-[12px] text-muted-foreground flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-primary" /> {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FeaturesEditor({ value = [], onChange }) {
  const [adding, setAdding] = useState('');

  const add = () => {
    const title = adding.trim();
    if (!title) return;
    onChange([...value, { title }]);
    setAdding('');
  };

  const setTitleAt = (i, title) => {
    onChange(value.map((f, idx) => (idx === i ? { ...f, title } : f)));
  };

  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const removeAt = (i) => {
    onChange(value.filter((_, idx) => idx !== i));
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-[12px] font-medium text-muted-foreground">Features</label>
        <span className="text-[11px] text-muted-foreground">{value.length} feature{value.length === 1 ? '' : 's'}</span>
      </div>
      {value.length === 0 ? (
        <p className="text-[12px] text-muted-foreground border border-dashed border-border rounded-lg p-3 text-center mt-2">
          No features yet — add the first one below.
        </p>
      ) : (
        <div className="space-y-1.5 mt-2">
          {value.map((f, i) => (
            <div key={f.id || `new-${i}`} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                title="Move up"
                className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === value.length - 1}
                title="Move down"
                className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <input
                type="text"
                value={f.title}
                onChange={(e) => setTitleAt(i, e.target.value)}
                placeholder="Feature title"
                className="flex-1 h-9 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                title="Remove feature"
                className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 mt-2">
        <input
          type="text"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Add feature and press Enter"
          className="flex-1 h-9 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="w-3.5 h-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}

function CreatePackageModal({ title = 'Create Package', workspaceId, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', tier: 'silver', duration: 1, duration_unit: 'months', price: '',
    description: '', is_active: true, is_custom: false,
  });
  const [features, setFeatures] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      const payload = {
        ...form,
        workspace_id: workspaceId || null,
        price: parseFloat(form.price) || 0,
        duration: parseInt(form.duration) || 1,
      };
      const created = await PackagesService.create(payload);
      if (features.length > 0) {
        await PackagesService.saveFeatures(created.id, features);
      }
      onCreated();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to create package.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[13px]">{error}</div>
        )}
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Gold — 3 Months" />
        <div className="grid grid-cols-3 gap-3">
          <Select label="Tier" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
            <option value="silver">Silver</option>
            <option value="gold">Gold</option>
            <option value="platinum">Platinum</option>
            <option value="custom">Custom</option>
          </Select>
          <Input label="Duration" type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
          <Select label="Unit" value={form.duration_unit} onChange={(e) => setForm({ ...form, duration_unit: e.target.value })}>
            <option value="days">Days</option>
            <option value="weeks">Weeks</option>
            <option value="months">Months</option>
          </Select>
        </div>
        <Input label="Price ($)" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <TextArea label="Description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <FeaturesEditor value={features} onChange={setFeatures} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Creating…' : 'Create Package'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function EditPackageModal({ pkg, isAdmin, onClose, onUpdated }) {
  const [form, setForm] = useState({
    name: pkg.name || '',
    tier: pkg.tier || 'silver',
    duration: pkg.duration || 1,
    duration_unit: pkg.duration_unit || 'months',
    price: pkg.price || '',
    description: pkg.description || '',
    is_active: !!pkg.is_active,
  });
  const [features, setFeatures] = useState([]);
  const [featuresLoaded, setFeaturesLoaded] = useState(false);
  const [featureBaseline, setFeatureBaseline] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Structured features come from package_features (stable ids per row).
  // They load once when the modal opens; the loaded state becomes the
  // autosave baseline so merely opening the modal never triggers a save.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await PackagesService.listFeatures(pkg.id);
        if (!active) return;
        const mapped = rows.map((r) => ({ id: r.id, title: r.title }));
        setFeatures(mapped);
        setFeatureBaseline(JSON.stringify(mapped));
      } catch (err) {
        console.error(err);
      } finally {
        if (active) setFeaturesLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [pkg.id]);

  // Autosave (server-persistent). The snapshot covers BOTH the scalar
  // package fields and the structured features; the save applies each side
  // only when it actually diverged from its own frozen baseline.
  const scalarView = (f) => JSON.stringify([
    f.name,
    f.tier,
    String(f.duration),
    f.duration_unit,
    String(f.price),
    f.description,
    !!f.is_active,
  ]);
  const scalarBaseline = useMemo(() => scalarView(form), []);
  const featuresView = JSON.stringify(features);
  const autosave = useAutosave({
    id: pkg.id,
    enabled: featuresLoaded,
    snapshot: `${scalarView(form)}|${featuresView}`,
    lastSavedSnapshot: `${scalarBaseline}|${featureBaseline}`,
    save: async () => {
      if (scalarView(form) !== scalarBaseline) {
        const updates = isAdmin
          ? {
              ...form,
              price: parseFloat(form.price) || 0,
              duration: parseInt(form.duration) || 1,
            }
          : {
              name: form.name.trim(),
              price: parseFloat(form.price) || 0,
              is_active: !!form.is_active,
            };
        await PackagesService.update(pkg.id, updates);
      }
      if (JSON.stringify(features) !== featureBaseline) {
        await PackagesService.saveFeatures(pkg.id, features);
      }
    },
  });

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      await autosave.flush();
      if (autosave.status === 'error') {
        setError(autosave.error || 'Failed to save changes.');
        return;
      }
      onUpdated();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to update package.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Edit Package — ${pkg.name}`} size="lg">
      <div className="space-y-4">
        {!isAdmin && (
          <div className="p-3 rounded-lg bg-secondary/30 border border-border/50 text-[12px] text-muted-foreground">
            Workspace Owner view: you can edit the package <span className="text-foreground font-medium">name</span>,{' '}
            <span className="text-foreground font-medium">price</span>,{' '}
            <span className="text-foreground font-medium">features</span>, and{' '}
            <span className="text-foreground font-medium">availability</span>. Tier, duration, and currency are protected.
          </div>
        )}
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[13px]">{error}</div>
        )}
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        {isAdmin ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Select label="Tier" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                <option value="silver">Silver</option>
                <option value="gold">Gold</option>
                <option value="platinum">Platinum</option>
                <option value="custom">Custom</option>
              </Select>
              <Input label="Duration" type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
              <Select label="Unit" value={form.duration_unit} onChange={(e) => setForm({ ...form, duration_unit: e.target.value })}>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
                <option value="months">Months</option>
              </Select>
            </div>
            <Input label="Price ($)" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <TextArea label="Description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="text-primary focus:ring-primary"
              />
              <span>Active package</span>
            </label>
          </>
        ) : (
          <>
            <Input label="Price ($)" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <div className="grid grid-cols-2 gap-3 opacity-60 pointer-events-none">
              <Input label="Tier" value={form.tier} readOnly />
              <Input label={`Duration (${form.duration_unit})`} value={form.duration} readOnly />
            </div>
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="text-primary focus:ring-primary"
              />
              <span>Active package (visible to clients in this workspace)</span>
            </label>
          </>
        )}
        {featuresLoaded ? (
          <FeaturesEditor value={features} onChange={setFeatures} />
        ) : (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading features…
          </div>
        )}
        <div className="flex items-center justify-between pt-2">
          <SaveStatus status={autosave.status} dirty={autosave.dirty} onRetry={autosave.flush} />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}