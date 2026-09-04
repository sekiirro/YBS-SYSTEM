import React, { useState, useEffect, useMemo } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { FoodsService } from '@/services/foods';
import { hasPermission } from '@/lib/permissions';
import { PageHeader, LoadingState, EmptyState, Button, Modal, Input, Select } from '@/components/ui';
import { Apple, Plus, Search, Archive } from 'lucide-react';

export default function Foods() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [foods, setFoods] = useState([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const canManage = hasPermission(user, 'nutrition.fooddb');

  useEffect(() => { loadFoods(); }, []);

  const loadFoods = async () => {
    try {
      setLoading(true);
      const data = await FoodsService.list();
      setFoods(data);
    } catch (err) {
      console.error(err);
    } finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    return foods.filter((f) => {
      if (search) {
        const term = search.toLowerCase();
        const haystack = [f.name, f.name_ar, f.brand, ...(f.aliases || [])]
          .filter(Boolean)
          .map((s) => s.toLowerCase())
          .join(' ');
        if (!haystack.includes(term)) return false;
      }
      if (catFilter !== 'all' && f.category !== catFilter) return false;
      return true;
    });
  }, [foods, search, catFilter]);

  if (loading) return <LoadingState label="Loading food database…" />;

  return (
    <div>
      <PageHeader
        title="Food Database"
        description="Nutritional information for meal planning"
        icon={Apple}
        actions={canManage && <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" /> Add Food</Button>}
      />
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search foods…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-4 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40" />
        </div>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
          className="h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[13px] focus:outline-none focus:border-primary/40">
          <option value="all">All Categories</option>
          {['protein','carbs','fats','vegetables','fruits','dairy','beverages','other'].map((c) => (
            <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={Apple} title="No foods found" description="Add foods to your database" />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Food</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Serving</th>
                  <th className="text-right px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Cal</th>
                  <th className="text-right px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Protein</th>
                  <th className="text-right px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Carbs</th>
                  <th className="text-right px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Fat</th>
                  {canManage && <th className="text-right px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-[13px] font-medium">
                        {f.name}
                        {f.brand && <span className="ml-2 text-[11px] font-normal text-muted-foreground">{f.brand}</span>}
                      </p>
                      <p className="text-[11px] text-muted-foreground capitalize">
                        {[f.category, f.name_ar].filter(Boolean).join(' · ')}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{f.serving_unit}</td>
                    <td className="px-4 py-3 text-[12px] text-right tabular-nums">{f.calories}</td>
                    <td className="px-4 py-3 text-[12px] text-right tabular-nums">{f.protein}g</td>
                    <td className="px-4 py-3 text-[12px] text-right tabular-nums">{f.carbs}g</td>
                    <td className="px-4 py-3 text-[12px] text-right tabular-nums">{f.fat}g</td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setArchiveTarget(f)}
                          title="Remove food"
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Archive className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {showCreate && <CreateFoodModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadFoods(); }} />}
      {archiveTarget && (
        <Modal open onClose={() => setArchiveTarget(null)} title="Remove Food" size="lg">
          <div className="space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Are you sure you want to remove <span className="font-medium text-foreground">{archiveTarget.name}</span>?
              It will be hidden from active lists, but existing nutrition plans that reference it will keep working.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setArchiveTarget(null)}>Cancel</Button>
              <Button variant="destructive" onClick={async () => {
                await FoodsService.delete(archiveTarget.id);
                setArchiveTarget(null);
                loadFoods();
              }}>Remove</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CreateFoodModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', name_ar: '', brand: '', aliases: '', serving_unit: '100g', serving_size: 100, calories: '', protein: '', carbs: '', fat: '', category: 'protein' });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    try {
      setSaving(true);
      await FoodsService.create({
        name: form.name,
        name_ar: form.name_ar || null,
        brand: form.brand || null,
        aliases: form.aliases ? form.aliases.split(',').map((a) => a.trim()).filter(Boolean) : [],
        serving_unit: form.serving_unit,
        serving_size: parseFloat(form.serving_size) || 100,
        calories: parseFloat(form.calories) || 0,
        protein: parseFloat(form.protein) || 0,
        carbs: parseFloat(form.carbs) || 0,
        fat: parseFloat(form.fat) || 0,
        category: form.category,
        source: 'manual',
      });
      onCreated();
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="Add Food" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Food Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Chicken Breast" />
          <Input label="Arabic Name (optional)" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} placeholder="صدر دجاج" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Brand (optional)" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="Juhayna" />
          <Input label="Aliases / Search Terms (comma separated)" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} placeholder="chicken, صدور دجاج" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Serving Unit" value={form.serving_unit} onChange={(e) => setForm({ ...form, serving_unit: e.target.value })} placeholder="100g" />
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {['protein','carbs','fats','vegetables','fruits','dairy','beverages','other'].map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Input label="Calories" type="number" value={form.calories} onChange={(e) => setForm({ ...form, calories: e.target.value })} />
          <Input label="Protein (g)" type="number" value={form.protein} onChange={(e) => setForm({ ...form, protein: e.target.value })} />
          <Input label="Carbs (g)" type="number" value={form.carbs} onChange={(e) => setForm({ ...form, carbs: e.target.value })} />
          <Input label="Fat (g)" type="number" value={form.fat} onChange={(e) => setForm({ ...form, fat: e.target.value })} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Creating…' : 'Add Food'}</Button>
        </div>
      </div>
    </Modal>
  );
}
