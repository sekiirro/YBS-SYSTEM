const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { PageHeader, LoadingState, EmptyState, Badge, Button, Modal, Input, Select, TextArea } from '@/components/ui';
import { formatCurrency, calculateSubscriptionEnd } from '@/lib/ybs-utils';
import { Package as PackageIcon, Plus, Edit, Archive, Search } from 'lucide-react';

export default function Packages() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const canManage = hasPermission(user, 'clients.create') && user.role !== 'trainer';

  useEffect(() => { loadPackages(); }, []);

  const loadPackages = async () => {
    try {
      setLoading(true);
      const data = await db.entities.Package.list('-created_date', 100);
      setPackages(data);
    } finally { setLoading(false); }
  };

  const filtered = packages.filter((p) =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <LoadingState label="Loading packages…" />;

  return (
    <div>
      <PageHeader
        title="Packages"
        description="Subscription package management"
        icon={PackageIcon}
        actions={canManage && <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" /> Add Package</Button>}
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text" placeholder="Search packages…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
        />
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={PackageIcon} title="No packages" description="Create your first subscription package" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div key={p.id} className="surface-card p-5 transition-all hover:glow-subtle">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-[15px] font-display font-semibold">{p.name}</h3>
                  <Badge className="mt-1 capitalize text-muted-foreground bg-secondary border-border">{p.tier}</Badge>
                </div>
                {p.is_active ? (
                  <Badge className="text-emerald-400 bg-emerald-500/10 border-emerald-500/20">Active</Badge>
                ) : (
                  <Badge className="text-zinc-400 bg-zinc-500/10 border-zinc-500/20">Inactive</Badge>
                )}
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
          ))}
        </div>
      )}
      {showCreate && <CreatePackageModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadPackages(); }} />}
    </div>
  );
}

function CreatePackageModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', tier: 'silver', duration: 1, duration_unit: 'months', price: '',
    description: '', is_active: true, is_custom: false, features: [],
  });
  const [saving, setSaving] = useState(false);
  const [featureInput, setFeatureInput] = useState('');

  const handleSave = async () => {
    try {
      setSaving(true);
      await db.entities.Package.create({
        ...form,
        price: parseFloat(form.price) || 0,
        duration: parseInt(form.duration) || 1,
      });
      onCreated();
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="Create Package" size="lg">
      <div className="space-y-4">
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
        <div>
          <label className="text-[12px] font-medium text-muted-foreground">Features</label>
          <div className="flex gap-2 mt-1.5">
            <input
              type="text" value={featureInput} onChange={(e) => setFeatureInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (featureInput) { setForm({ ...form, features: [...form.features, featureInput] }); setFeatureInput(''); } } }}
              placeholder="Add feature and press Enter"
              className="flex-1 h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40"
            />
          </div>
          {form.features.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {form.features.map((f, i) => (
                <span key={i} className="px-2 py-1 rounded-md bg-secondary text-[12px] flex items-center gap-1.5">
                  {f}
                  <button onClick={() => setForm({ ...form, features: form.features.filter((_, idx) => idx !== i) })} className="text-muted-foreground hover:text-red-400">×</button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Creating…' : 'Create Package'}</Button>
        </div>
      </div>
    </Modal>
  );
}