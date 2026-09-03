const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';

import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { LoadingState, Badge, Button, Modal, Input, Select, TextArea } from '@/components/ui';
import { formatDate, getSubscriptionStatusColor, daysUntil, getInitials } from '@/lib/ybs-utils';
import {
  ArrowLeft, Phone, Mail, Calendar, User, Package, CreditCard,
  ClipboardList, TrendingUp, Apple, Dumbbell, Bell, Activity, Edit, Send, Plus
} from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'overview', label: 'Overview', icon: User },
  { id: 'subscription', label: 'Subscription', icon: CreditCard },
  { id: 'forms', label: 'Forms', icon: ClipboardList },
  { id: 'metrics', label: 'Metrics', icon: TrendingUp },
  { id: 'nutrition', label: 'Nutrition', icon: Apple },
  { id: 'workout', label: 'Workout', icon: Dumbbell },
  { id: 'timeline', label: 'Timeline', icon: Activity },
];

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [showEdit, setShowEdit] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [forms, setForms] = useState([]);
  const [metrics, setMetrics] = useState([]);

  useEffect(() => {
    loadClient();
  }, [id]);

  const loadClient = async () => {
    try {
      setLoading(true);
      const c = await db.entities.Client.get(id);
      setClient(c);

      const [tl, subs, frm, mtr] = await Promise.all([
        db.entities.TimelineEvent.filter({ client_id: id }, '-created_date', 50),
        db.entities.Subscription.filter({ client_id: id }, '-start_date', 50),
        db.entities.Assessment.filter({ assigned_client_id: id, is_template: false }, '-created_date', 50),
        db.entities.MetricEntry.filter({ client_id: id }, '-entry_date', 50),
      ]);
      setTimeline(tl);
      setSubscriptions(subs);
      setForms(frm);
      setMetrics(mtr);
    } catch (err) {
      console.error('Error loading client:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingState label="Loading client…" />;
  if (!client) return <div className="text-center py-16 text-muted-foreground">Client not found</div>;

  const canEdit = hasPermission(user, 'clients.update') && (user.role !== 'trainer');

  return (
    <div>
      {/* Back nav */}
      <button onClick={() => navigate('/clients')} className="flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground mb-4 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Clients
      </button>

      {/* Header card */}
      <div className="surface-card p-5 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/15 flex items-center justify-center text-primary text-lg font-semibold shrink-0">
              {getInitials(client.full_name)}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-display font-semibold tracking-tight">{client.full_name}</h1>
                <Badge className={cn(getSubscriptionStatusColor(client.subscription_status), 'capitalize')}>
                  {client.subscription_status?.replace('_', ' ') || 'none'}
                </Badge>
              </div>
              <p className="text-[12px] text-muted-foreground font-mono mt-1">{client.client_code}</p>
              <div className="flex items-center gap-4 mt-2 flex-wrap text-[12px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {client.phone || '—'}</span>
                {client.email && <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> {client.email}</span>}
                <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Joined {formatDate(client.join_date)}</span>
              </div>
            </div>
          </div>
          {canEdit && (
            <Button variant="secondary" onClick={() => setShowEdit(true)}>
              <Edit className="w-4 h-4" /> Edit
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2 rounded-lg text-[13px] font-medium whitespace-nowrap transition-all',
                activeTab === tab.id
                  ? 'bg-secondary text-foreground border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              )}
            >
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="surface-card p-5">
        {activeTab === 'overview' && <OverviewTab client={client} />}
        {activeTab === 'subscription' && <SubscriptionTab client={client} subscriptions={subscriptions} user={user} onUpdated={loadClient} />}
        {activeTab === 'forms' && <FormsTab forms={forms} />}
        {activeTab === 'metrics' && <MetricsTab metrics={metrics} clientId={id} client={client} onUpdated={loadClient} />}
        {activeTab === 'nutrition' && <NutritionTab clientId={id} />}
        {activeTab === 'workout' && <WorkoutTab clientId={id} />}
        {activeTab === 'timeline' && <TimelineTab timeline={timeline} />}
      </div>

      {showEdit && <EditClientModal client={client} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); loadClient(); }} />}
    </div>
  );
}

function OverviewTab({ client }) {
  const info = [
    { label: 'Date of Birth', value: formatDate(client.date_of_birth) },
    { label: 'Gender', value: client.gender ? client.gender.charAt(0).toUpperCase() + client.gender.slice(1) : '—' },
    { label: 'Height', value: client.height ? `${client.height} cm` : '—' },
    { label: 'Current Weight', value: client.current_weight ? `${client.current_weight} kg` : '—' },
    { label: 'Body Fat %', value: client.body_fat ? `${client.body_fat}%` : '—' },
    { label: 'Assigned Trainer', value: client.assigned_trainer_name || '—' },
    { label: 'Package', value: client.package_name || '—' },
    { label: 'Follow-up Day', value: client.follow_up_day ? client.follow_up_day.charAt(0).toUpperCase() + client.follow_up_day.slice(1) : '—' },
    { label: 'Telegram', value: client.telegram_connected ? 'Connected' : 'Not Connected' },
    { label: 'Subscription End', value: formatDate(client.subscription_end_date) },
  ];
  return (
    <div>
      <h3 className="text-[14px] font-display font-semibold mb-4">Client Information</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
        {info.map((item) => (
          <div key={item.label} className="flex flex-col">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{item.label}</span>
            <span className="text-[13px] font-medium mt-1">{item.value}</span>
          </div>
        ))}
      </div>
      {client.notes && (
        <div className="mt-6 pt-4 border-t border-border">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Notes</span>
          <p className="text-[13px] mt-1.5 text-muted-foreground">{client.notes}</p>
        </div>
      )}
    </div>
  );
}

function SubscriptionTab({ client, subscriptions, user, onUpdated }) {
  const canManage = hasPermission(user, 'clients.update') && user.role !== 'trainer';
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-display font-semibold">Subscription History</h3>
        {canManage && <Button size="sm"><Plus className="w-4 h-4" /> New Subscription</Button>}
      </div>
      {subscriptions.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-8 text-center">No subscription history</p>
      ) : (
        <div className="space-y-3">
          {subscriptions.map((s) => (
            <div key={s.id} className="p-4 rounded-lg bg-secondary/30 border border-border">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium">{s.package_name || 'Package'}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(s.start_date)} → {formatDate(s.end_date)}</p>
                </div>
                <Badge className={cn(getSubscriptionStatusColor(s.status), 'capitalize')}>{s.status.replace('_', ' ')}</Badge>
              </div>
              {s.price != null && (
                <p className="text-[12px] text-muted-foreground mt-2">Price: ${s.price} · Payment: <span className="capitalize">{s.payment_status}</span></p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FormsTab({ forms }) {
  return (
    <div>
      <h3 className="text-[14px] font-display font-semibold mb-4">Assigned Forms</h3>
      {forms.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-8 text-center">No forms assigned</p>
      ) : (
        <div className="space-y-2">
          {forms.map((f) => (
            <div key={f.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border">
              <div>
                <p className="text-[13px] font-medium">{f.name}</p>
                <p className="text-[11px] text-muted-foreground">Due {formatDate(f.due_date)}</p>
              </div>
              <Badge className={cn(
                f.submission_status === 'reviewed' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                f.submission_status === 'submitted' ? 'text-sky-400 bg-sky-500/10 border-sky-500/20' :
                f.submission_status === 'overdue' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                'text-amber-400 bg-amber-500/10 border-amber-500/20',
                'capitalize'
              )}>{f.submission_status}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricsTab({ metrics, clientId, client, onUpdated }) {
  const [showAdd, setShowAdd] = useState(false);
  const { user } = useAuth();
  const canEdit = hasPermission(user, 'metrics.update');

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-display font-semibold">Progress Metrics</h3>
        {canEdit && <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add Entry</Button>}
      </div>
      {metrics.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-8 text-center">No metrics recorded yet</p>
      ) : (
        <div className="space-y-3">
          {metrics.map((m) => (
            <div key={m.id} className="p-4 rounded-lg bg-secondary/30 border border-border">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] font-medium">{formatDate(m.entry_date)}</p>
                {m.ai_analysis && <Badge className="text-primary bg-primary/10 border-primary/20">AI Analyzed</Badge>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-[12px]">
                {m.weight != null && <Metric label="Weight" value={`${m.weight} kg`} />}
                {m.body_fat != null && <Metric label="Body Fat" value={`${m.body_fat}%`} />}
                {m.chest != null && <Metric label="Chest" value={`${m.chest} cm`} />}
                {m.waist != null && <Metric label="Waist" value={`${m.waist} cm`} />}
                {m.right_arm != null && <Metric label="R Arm" value={`${m.right_arm} cm`} />}
                {m.right_thigh != null && <Metric label="R Thigh" value={`${m.right_thigh} cm`} />}
              </div>
            </div>
          ))}
        </div>
      )}
      {showAdd && <AddMetricModal clientId={clientId} clientName={client.full_name} trainerId={client.assigned_trainer_id} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); onUpdated(); }} />}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className="font-medium mt-0.5">{value}</p>
    </div>
  );
}

function NutritionTab({ clientId }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.entities.NutritionPlan.filter({ client_id: clientId, is_archived: false }, '-created_date', 10)
      .then(setPlans)
      .finally(() => setLoading(false));
  }, [clientId]);

  if (loading) return <LoadingState label="Loading nutrition plans…" />;
  return (
    <div>
      <h3 className="text-[14px] font-display font-semibold mb-4">Nutrition Plans</h3>
      {plans.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-8 text-center">No nutrition plans assigned</p>
      ) : (
        <div className="space-y-3">
          {plans.map((p) => (
            <div key={p.id} className="p-4 rounded-lg bg-secondary/30 border border-border">
              <p className="text-[13px] font-medium">{p.name}</p>
              <div className="flex gap-4 mt-2 text-[12px] text-muted-foreground">
                {p.daily_calories != null && <span>Cal: {p.daily_calories}</span>}
                {p.daily_protein != null && <span>Protein: {p.daily_protein}g</span>}
                {p.daily_carbs != null && <span>Carbs: {p.daily_carbs}g</span>}
                {p.daily_fat != null && <span>Fat: {p.daily_fat}g</span>}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{p.meals?.length || 0} meals</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkoutTab({ clientId }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.entities.WorkoutPlan.filter({ client_id: clientId, is_archived: false }, '-created_date', 10)
      .then(setPlans)
      .finally(() => setLoading(false));
  }, [clientId]);

  if (loading) return <LoadingState label="Loading workout plans…" />;
  return (
    <div>
      <h3 className="text-[14px] font-display font-semibold mb-4">Workout Plans</h3>
      {plans.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-8 text-center">No workout plans assigned</p>
      ) : (
        <div className="space-y-3">
          {plans.map((p) => (
            <div key={p.id} className="p-4 rounded-lg bg-secondary/30 border border-border">
              <p className="text-[13px] font-medium">{p.name}</p>
              <p className="text-[11px] text-muted-foreground mt-1 capitalize">{p.split_type?.replace('_', ' ')} · {p.days?.length || 0} days</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TimelineTab({ timeline }) {
  return (
    <div>
      <h3 className="text-[14px] font-display font-semibold mb-4">Client Timeline</h3>
      {timeline.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-8 text-center">No activity recorded yet</p>
      ) : (
        <div className="relative space-y-4 pl-6">
          <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />
          {timeline.map((event) => (
            <div key={event.id} className="relative">
              <div className="absolute -left-[18px] top-1.5 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-background" />
              <p className="text-[13px] font-medium">{event.title}</p>
              {event.description && <p className="text-[12px] text-muted-foreground mt-0.5">{event.description}</p>}
              <p className="text-[11px] text-muted-foreground mt-1">{formatDate(event.created_date, 'MMM d, yyyy · h:mm a')} · {event.actor_name || 'System'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditClientModal({ client, onClose, onSaved }) {
  const [form, setForm] = useState({ ...client });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    try {
      setSaving(true);
      await db.entities.Client.update(client.id, form);
      onSaved();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Edit Client" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Full Name" value={form.full_name || ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <Input label="Phone" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Date of Birth" type="date" value={form.date_of_birth || ''} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Height (cm)" type="number" value={form.height || ''} onChange={(e) => setForm({ ...form, height: parseFloat(e.target.value) })} />
          <Input label="Weight (kg)" type="number" value={form.current_weight || ''} onChange={(e) => setForm({ ...form, current_weight: parseFloat(e.target.value) })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Body Fat %" type="number" value={form.body_fat || ''} onChange={(e) => setForm({ ...form, body_fat: parseFloat(e.target.value) })} />
          <Select label="Follow-up Day" value={form.follow_up_day || ''} onChange={(e) => setForm({ ...form, follow_up_day: e.target.value })}>
            {['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((d) => (
              <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
            ))}
          </Select>
        </div>
        <TextArea label="Notes" rows={3} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function AddMetricModal({ clientId, clientName, trainerId, onClose, onSaved }) {
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().split('T')[0],
    weight: '',
    body_fat: '',
    chest: '',
    waist: '',
    hip: '',
    right_arm: '',
    left_arm: '',
    right_thigh: '',
    left_thigh: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    try {
      setSaving(true);
      const data = { ...form, client_id: clientId, client_name: clientName, trainer_id: trainerId };
      Object.keys(data).forEach((k) => {
        if (data[k] === '' || data[k] === null) delete data[k];
        if (typeof data[k] === 'string' && k !== 'entry_date' && k !== 'notes' && data[k] !== '') data[k] = parseFloat(data[k]);
      });
      await db.entities.MetricEntry.create(data);
      await db.entities.TimelineEvent.create({
        client_id: clientId,
        client_name: clientName,
        event_type: 'metrics_submitted',
        title: 'New metrics entry recorded',
        actor_id: trainerId,
      });
      onSaved();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add Metrics Entry" size="lg">
      <div className="space-y-4">
        <Input label="Date" type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Input label="Weight (kg)" type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
          <Input label="Body Fat %" type="number" value={form.body_fat} onChange={(e) => setForm({ ...form, body_fat: e.target.value })} />
          <Input label="Chest (cm)" type="number" value={form.chest} onChange={(e) => setForm({ ...form, chest: e.target.value })} />
          <Input label="Waist (cm)" type="number" value={form.waist} onChange={(e) => setForm({ ...form, waist: e.target.value })} />
          <Input label="Hip (cm)" type="number" value={form.hip} onChange={(e) => setForm({ ...form, hip: e.target.value })} />
          <Input label="R Arm (cm)" type="number" value={form.right_arm} onChange={(e) => setForm({ ...form, right_arm: e.target.value })} />
          <Input label="L Arm (cm)" type="number" value={form.left_arm} onChange={(e) => setForm({ ...form, left_arm: e.target.value })} />
          <Input label="R Thigh (cm)" type="number" value={form.right_thigh} onChange={(e) => setForm({ ...form, right_thigh: e.target.value })} />
          <Input label="L Thigh (cm)" type="number" value={form.left_thigh} onChange={(e) => setForm({ ...form, left_thigh: e.target.value })} />
        </div>
        <TextArea label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Entry'}</Button>
        </div>
      </div>
    </Modal>
  );
}