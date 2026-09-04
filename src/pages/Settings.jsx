import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { isPlatformAdmin, getActiveWorkspaceId } from '@/lib/ybs-auth';
import { WorkspacesService } from '@/services/workspaces';
import { PartnershipTypesService } from '@/services/partnershipTypes';
import { PageHeader, Badge, Button, Input, Select, LoadingState } from '@/components/ui';
import {
  Settings as SettingsIcon, Shield, Bell, Building2,
  Handshake, Gauge, Palette, CheckCircle2,
  Link2, Phone, Mail, Copy, ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = isPlatformAdmin(user);
  const activeWsId = getActiveWorkspaceId(user);

  const [section, setSection] = useState('general');
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);
  const [capacityStats, setCapacityStats] = useState(null);
  const [partnershipTypes, setPartnershipTypes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ error: '', success: '' });

  // Form states
  const [generalForm, setGeneralForm] = useState({
    name: '',
    timezone: 'Africa/Cairo',
    currency: 'EGP',
    default_follow_up_day: 'saturday',
  });

  const [partnershipForm, setPartnershipForm] = useState({
    partnership_type_id: '',
  });

  const [capacityForm, setCapacityForm] = useState({
    is_unlimited: true,
    client_capacity: 50,
  });

  const [brandingForm, setBrandingForm] = useState({
    logo_url: '',
    primary_color: '#3B82F6',
    accent_color: '#10B981',
    brand_tagline: '',
  });

  const [registrationForm, setRegistrationForm] = useState({
    registration_enabled: true,
  });

  const [contactForm, setContactForm] = useState({
    owner_email: '',
    owner_phone: '',
  });

  const [copiedLink, setCopiedLink] = useState(false);

  const registrationLink = workspace?.public_join_token
    ? `${window.location.origin}/join/${workspace.public_join_token}`
    : '';

  const copyRegistrationLink = async () => {
    if (!registrationLink) return;
    try {
      await navigator.clipboard.writeText(registrationLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error('Failed to copy registration link:', err);
    }
  };

  useEffect(() => {
    loadSettings();
  }, [activeWsId]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setFeedback({ error: '', success: '' });

      const [pts, ws, stats] = await Promise.all([
        PartnershipTypesService.list().catch(() => []),
        activeWsId ? WorkspacesService.getById(activeWsId).catch(() => null) : null,
        activeWsId ? WorkspacesService.getCapacityStats(activeWsId).catch(() => null) : null,
      ]);

      setPartnershipTypes(pts || []);

      if (ws) {
        setWorkspace(ws);
        setGeneralForm({
          name: ws.name || '',
          timezone: ws.timezone || ws.settings?.timezone || 'Africa/Cairo',
          currency: ws.currency || ws.settings?.currency || 'EGP',
          default_follow_up_day: ws.settings?.default_follow_up_day || 'saturday',
        });

        setPartnershipForm({
          partnership_type_id: ws.partnership_type_id || pts[0]?.id || '',
        });

        setCapacityForm({
          is_unlimited: ws.client_capacity === null || ws.client_capacity === undefined,
          client_capacity: ws.client_capacity || 50,
        });

        setBrandingForm({
          logo_url: ws.settings?.branding?.logo_url || '',
          primary_color: ws.settings?.branding?.primary_color || '#3B82F6',
          accent_color: ws.settings?.branding?.accent_color || '#10B981',
          brand_tagline: ws.settings?.branding?.brand_tagline || '',
        });

        setRegistrationForm({
          registration_enabled: ws.settings?.registration_enabled !== false,
        });

        setContactForm({
          owner_email: ws.owner_email || '',
          owner_phone: ws.owner_phone || '',
        });
      }

      if (stats) {
        setCapacityStats(stats);
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveGeneral = async (e) => {
    e.preventDefault();
    if (!activeWsId) return;
    setSaving(true);
    setFeedback({ error: '', success: '' });

    try {
      const updatedSettings = {
        ...(workspace?.settings || {}),
        timezone: generalForm.timezone,
        currency: generalForm.currency,
        default_follow_up_day: generalForm.default_follow_up_day,
      };

      await WorkspacesService.update(activeWsId, {
        name: generalForm.name.trim(),
        timezone: generalForm.timezone,
        currency: generalForm.currency,
        settings: updatedSettings,
      });

      setFeedback({ error: '', success: 'General workspace settings saved successfully.' });
      loadSettings();
    } catch (err) {
      setFeedback({ error: err.message || 'Failed to save settings', success: '' });
    } finally {
      setSaving(false);
    }
  };

  const handleSavePartnership = async (e) => {
    e.preventDefault();
    if (!activeWsId) return;
    setSaving(true);
    setFeedback({ error: '', success: '' });

    try {
      await WorkspacesService.update(activeWsId, {
        partnership_type_id: partnershipForm.partnership_type_id || null,
      });

      setFeedback({ error: '', success: 'Partnership type updated successfully.' });
      loadSettings();
    } catch (err) {
      setFeedback({ error: err.message || 'Failed to update partnership type', success: '' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCapacity = async (e) => {
    e.preventDefault();
    if (!activeWsId) return;
    setSaving(true);
    setFeedback({ error: '', success: '' });

    try {
      const capacityVal = capacityForm.is_unlimited
        ? null
        : Math.max(1, parseInt(capacityForm.client_capacity, 10) || 1);

      await WorkspacesService.update(activeWsId, {
        client_capacity: capacityVal,
      });

      setFeedback({ error: '', success: 'Client capacity configuration updated successfully.' });
      loadSettings();
    } catch (err) {
      setFeedback({ error: err.message || 'Failed to update client capacity', success: '' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBranding = async (e) => {
    e.preventDefault();
    if (!activeWsId) return;
    setSaving(true);
    setFeedback({ error: '', success: '' });

    try {
      const updatedSettings = {
        ...(workspace?.settings || {}),
        branding: brandingForm,
      };

      await WorkspacesService.update(activeWsId, {
        settings: updatedSettings,
      });

      setFeedback({ error: '', success: 'Branding identity updated successfully.' });
      loadSettings();
    } catch (err) {
      setFeedback({ error: err.message || 'Failed to update branding', success: '' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRegistration = async (e) => {
    e.preventDefault();
    if (!activeWsId) return;
    setSaving(true);
    setFeedback({ error: '', success: '' });

    try {
      const updatedSettings = {
        ...(workspace?.settings || {}),
        registration_enabled: registrationForm.registration_enabled,
      };

      await WorkspacesService.update(activeWsId, {
        settings: updatedSettings,
      });

      setFeedback({
        error: '',
        success: registrationForm.registration_enabled
          ? 'Registration link is now ENABLED and accepting new trainees.'
          : 'Registration link is now DISABLED. New sign-ups will be rejected.',
      });
      loadSettings();
    } catch (err) {
      setFeedback({ error: err.message || 'Failed to update registration settings', success: '' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveContact = async (e) => {
    e.preventDefault();
    if (!activeWsId) return;
    setSaving(true);
    setFeedback({ error: '', success: '' });

    try {
      await WorkspacesService.update(activeWsId, {
        owner_phone: contactForm.owner_phone.trim(),
      });

      setFeedback({ error: '', success: 'Contact details updated successfully.' });
      loadSettings();
    } catch (err) {
      setFeedback({ error: err.message || 'Failed to update contact details', success: '' });
    } finally {
      setSaving(false);
    }
  };

  const sections = [
    { id: 'general', label: 'General', icon: Building2 },
    { id: 'registration', label: 'Registration Link', icon: Link2 },
    { id: 'contact', label: 'Contact', icon: Phone },
    { id: 'partnership', label: 'Partnership', icon: Handshake },
    { id: 'capacity', label: 'Client Capacity', icon: Gauge },
    { id: 'branding', label: 'Branding', icon: Palette },
    { id: 'permissions', label: 'Permissions', icon: Shield },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ];

  if (loading) return <LoadingState label="Loading workspace settings…" />;

  const currentPt = partnershipTypes.find((p) => p.id === workspace?.partnership_type_id);

  return (
    <div>
      <PageHeader
        title="Workspace Settings"
        description={`Operational and branding configuration for ${workspace?.name || 'Workspace'}`}
        icon={SettingsIcon}
      />

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Navigation Sidebar */}
        <div className="lg:w-60 shrink-0">
          <div className="surface-card p-2 space-y-1">
            {sections.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    setSection(s.id);
                    setFeedback({ error: '', success: '' });
                  }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors text-left',
                    section === s.id
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Content Pane */}
        <div className="flex-1">
          <div className="surface-card p-6">
            {feedback.error && (
              <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-[13px]">
                {feedback.error}
              </div>
            )}
            {feedback.success && (
              <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[13px] flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{feedback.success}</span>
              </div>
            )}

            {/* 1. General Settings */}
            {section === 'general' && (
              <form onSubmit={handleSaveGeneral} className="space-y-4">
                <div>
                  <h3 className="text-[15px] font-display font-semibold text-foreground">Operational Configuration</h3>
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    Core parameters defining workspace naming, regional time, and currency.
                  </p>
                </div>

                <Input
                  label="Workspace / Brand Name"
                  value={generalForm.name}
                  onChange={(e) => setGeneralForm({ ...generalForm, name: e.target.value })}
                  required
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Select
                    label="Operational Timezone"
                    value={generalForm.timezone}
                    onChange={(e) => setGeneralForm({ ...generalForm, timezone: e.target.value })}
                  >
                    <option value="Africa/Cairo">Africa/Cairo (UTC+2 / UTC+3)</option>
                    <option value="Asia/Riyadh">Asia/Riyadh (UTC+3)</option>
                    <option value="Asia/Dubai">Asia/Dubai (UTC+4)</option>
                    <option value="Europe/London">Europe/London (GMT/BST)</option>
                    <option value="UTC">UTC</option>
                  </Select>

                  <Select
                    label="Primary Billing Currency"
                    value={generalForm.currency}
                    onChange={(e) => setGeneralForm({ ...generalForm, currency: e.target.value })}
                  >
                    <option value="EGP">EGP — Egyptian Pound</option>
                    <option value="SAR">SAR — Saudi Riyal</option>
                    <option value="AED">AED — UAE Dirham</option>
                    <option value="USD">USD — US Dollar</option>
                    <option value="EUR">EUR — Euro</option>
                    <option value="KWD">KWD — Kuwaiti Dinar</option>
                  </Select>
                </div>

                <Select
                  label="Default Follow-up Check-in Day"
                  value={generalForm.default_follow_up_day}
                  onChange={(e) => setGeneralForm({ ...generalForm, default_follow_up_day: e.target.value })}
                >
                  {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => (
                    <option key={d} value={d}>
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </option>
                  ))}
                </Select>

                <div className="pt-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving Changes…' : 'Save General Settings'}
                  </Button>
                </div>
              </form>
            )}

            {/* 1.5 Registration Link */}
            {section === 'registration' && (
              <form onSubmit={handleSaveRegistration} className="space-y-4">
                <div>
                  <h3 className="text-[15px] font-display font-semibold text-foreground">Trainee Registration Link</h3>
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    Share this link so trainees can self-register into your workspace. You can enable or disable it at
                    any time — disabled links stop accepting new sign-ups immediately.
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-secondary/30 border border-border space-y-2">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5 text-primary" /> Registration Status
                    </span>
                    <Badge className={cn(
                      registrationForm.registration_enabled
                        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                        : 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20'
                    )}>
                      {registrationForm.registration_enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {registrationForm.registration_enabled
                      ? 'New trainees using this link can submit an application for approval.'
                      : 'Registration is closed. The link shows a "registration closed" page and server-side sign-ups are rejected.'}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input
                        type="radio"
                        name="reg_status"
                        checked={registrationForm.registration_enabled}
                        onChange={() => setRegistrationForm({ ...registrationForm, registration_enabled: true })}
                        className="text-primary focus:ring-primary"
                      />
                      <span>Registration Open</span>
                    </label>
                    <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input
                        type="radio"
                        name="reg_status"
                        checked={!registrationForm.registration_enabled}
                        onChange={() => setRegistrationForm({ ...registrationForm, registration_enabled: false })}
                        className="text-primary focus:ring-primary"
                      />
                      <span>Registration Closed</span>
                    </label>
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-border/50 bg-secondary/20 space-y-2">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Registration Link</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={registrationLink || 'Registration link unavailable'}
                      className="flex-1 h-10 px-3 rounded-lg bg-secondary/50 border border-border text-[12px] font-mono text-foreground focus:outline-none"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={copyRegistrationLink}
                      disabled={!registrationLink}
                      className="shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" /> {copiedLink ? 'Copied!' : 'Copy'}
                    </Button>
                    {registrationLink && (
                      <Button type="button" variant="ghost" asChild>
                        <a href={registrationLink} target="_blank" rel="noreferrer" className="flex items-center gap-1">
                          <ExternalLink className="w-3.5 h-3.5" /> Open
                        </a>
                      </Button>
                    )}
                  </div>
                </div>

                <div className="pt-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Save Registration Settings'}
                  </Button>
                </div>
              </form>
            )}

            {/* 1.75 Contact Information */}
            {section === 'contact' && (
              <form onSubmit={handleSaveContact} className="space-y-4">
                <div>
                  <h3 className="text-[15px] font-display font-semibold text-foreground">Brand Owner Contact</h3>
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    Primary contact details surfaced to applicants and internal staff.
                  </p>
                </div>

                <div>
                  <label className="text-[12px] font-medium text-muted-foreground flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-primary" /> Owner Email
                  </label>
                  <p className="mt-1.5 text-[13px] text-foreground font-mono px-3 py-2.5 rounded-lg bg-secondary/50 border border-border">
                    {contactForm.owner_email || '—'}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Email is derived from the workspace owner profile and cannot be changed here.
                  </p>
                </div>

                <Input
                  label="Owner Phone"
                  value={contactForm.owner_phone}
                  onChange={(e) => setContactForm({ ...contactForm, owner_phone: e.target.value })}
                  placeholder="+20 100 000 0000"
                />

                <div className="pt-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Save Contact Details'}
                  </Button>
                </div>
              </form>
            )}

            {/* 2. Partnership Settings */}
            {section === 'partnership' && (
              <form onSubmit={handleSavePartnership} className="space-y-4">
                <div>
                  <h3 className="text-[15px] font-display font-semibold text-foreground">Partnership Model</h3>
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    Formal partnership agreement determining coaching tier, infrastructure access, and trainer allocations.
                  </p>
                </div>

                {isAdmin ? (
                  <div className="space-y-4">
                    <Select
                      label="Partnership Type"
                      value={partnershipForm.partnership_type_id}
                      onChange={(e) => setPartnershipForm({ ...partnershipForm, partnership_type_id: e.target.value })}
                    >
                      {partnershipTypes.map((pt) => (
                        <option key={pt.id} value={pt.id}>
                          {pt.name} ({pt.code})
                        </option>
                      ))}
                    </Select>

                    {currentPt && (
                      <div className="p-3 rounded-lg bg-secondary/50 border border-border text-[13px]">
                        <p className="font-medium text-foreground">{currentPt.name}</p>
                        <p className="text-muted-foreground text-[12px] mt-1">{currentPt.description}</p>
                      </div>
                    )}

                    <div className="pt-2">
                      <Button type="submit" disabled={saving}>
                        {saving ? 'Updating Partnership…' : 'Update Partnership Type'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-4 rounded-lg bg-secondary/30 border border-border space-y-1">
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Current Partnership</span>
                      <p className="text-[15px] font-semibold text-foreground">{currentPt?.name || 'Standard Partnership'}</p>
                      <p className="text-[12px] text-muted-foreground">{currentPt?.description || 'Core coaching platform.'}</p>
                    </div>
                    <p className="text-[12px] text-muted-foreground">
                      Partnership tier is managed exclusively by the Platform Owner. Contact your platform administrator to adjust your tier.
                    </p>
                  </div>
                )}
              </form>
            )}

            {/* 3. Client Capacity Settings */}
            {section === 'capacity' && (
              <form onSubmit={handleSaveCapacity} className="space-y-5">
                <div>
                  <h3 className="text-[15px] font-display font-semibold text-foreground">Active Client Capacity</h3>
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    Server-enforced quota protecting coach-athlete quality ratios and operational limits.
                  </p>
                </div>

                {/* Live Utilization Card */}
                {capacityStats && (
                  <div className="p-4 rounded-lg bg-secondary/30 border border-border space-y-2">
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-muted-foreground">Live Utilization:</span>
                      <span className="font-semibold text-foreground">
                        {capacityStats.activeCount} / {capacityStats.isUnlimited ? 'Unlimited' : capacityStats.capacity} Active Clients
                        {!capacityStats.isUnlimited && ` (${capacityStats.utilizationPct}%)`}
                      </span>
                    </div>

                    {!capacityStats.isUnlimited && (
                      <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                        <div
                          className={cn(
                            'h-full transition-all duration-300 rounded-full',
                            capacityStats.isAtCapacity
                              ? 'bg-destructive'
                              : capacityStats.isWarning
                              ? 'bg-warning'
                              : 'bg-primary'
                          )}
                          style={{ width: `${Math.min(capacityStats.utilizationPct, 100)}%` }}
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                      <span>Threshold warning triggers at 90%</span>
                      <span>{capacityStats.totalCount} total historical clients</span>
                    </div>
                  </div>
                )}

                {isAdmin ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[13px] font-medium text-foreground block">Capacity Configuration</label>
                      <div className="flex items-center gap-6">
                        <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                          <input
                            type="radio"
                            name="cap_type"
                            checked={capacityForm.is_unlimited}
                            onChange={() => setCapacityForm({ ...capacityForm, is_unlimited: true })}
                            className="text-primary focus:ring-primary"
                          />
                          <span>Unlimited Capacity</span>
                        </label>
                        <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                          <input
                            type="radio"
                            name="cap_type"
                            checked={!capacityForm.is_unlimited}
                            onChange={() => setCapacityForm({ ...capacityForm, is_unlimited: false })}
                            className="text-primary focus:ring-primary"
                          />
                          <span>Capped Active Clients</span>
                        </label>
                      </div>
                    </div>

                    {!capacityForm.is_unlimited && (
                      <Input
                        label="Maximum Active Clients Limit"
                        type="number"
                        min="1"
                        value={capacityForm.client_capacity}
                        onChange={(e) => setCapacityForm({ ...capacityForm, client_capacity: e.target.value })}
                        required
                      />
                    )}

                    <div className="pt-2">
                      <Button type="submit" disabled={saving}>
                        {saving ? 'Saving Capacity…' : 'Update Client Capacity'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    Client capacity limits are calibrated by the Platform Owner. To expand capacity, please request an allocation increase.
                  </p>
                )}
              </form>
            )}

            {/* 4. Branding Settings */}
            {section === 'branding' && (
              <form onSubmit={handleSaveBranding} className="space-y-4">
                <div>
                  <h3 className="text-[15px] font-display font-semibold text-foreground">Brand Identity</h3>
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    Visual customizations tailored for client-facing views and portal aesthetics.
                  </p>
                </div>

                <Input
                  label="Brand Logo URL"
                  value={brandingForm.logo_url}
                  onChange={(e) => setBrandingForm({ ...brandingForm, logo_url: e.target.value })}
                  placeholder="https://example.com/logo.png"
                />

                <Input
                  label="Brand Tagline / Slogan"
                  value={brandingForm.brand_tagline}
                  onChange={(e) => setBrandingForm({ ...brandingForm, brand_tagline: e.target.value })}
                  placeholder="e.g. Science-Based Transformation Coaching"
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[13px] font-medium text-foreground block mb-1.5">Primary Theme Color</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={brandingForm.primary_color}
                        onChange={(e) => setBrandingForm({ ...brandingForm, primary_color: e.target.value })}
                        className="w-10 h-10 rounded border border-border cursor-pointer bg-transparent"
                      />
                      <Input
                        value={brandingForm.primary_color}
                        onChange={(e) => setBrandingForm({ ...brandingForm, primary_color: e.target.value })}
                        placeholder="#3B82F6"
                        className="font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[13px] font-medium text-foreground block mb-1.5">Accent Color</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={brandingForm.accent_color}
                        onChange={(e) => setBrandingForm({ ...brandingForm, accent_color: e.target.value })}
                        className="w-10 h-10 rounded border border-border cursor-pointer bg-transparent"
                      />
                      <Input
                        value={brandingForm.accent_color}
                        onChange={(e) => setBrandingForm({ ...brandingForm, accent_color: e.target.value })}
                        placeholder="#10B981"
                        className="font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving Branding…' : 'Save Brand Settings'}
                  </Button>
                </div>
              </form>
            )}

            {/* 5. Permissions */}
            {section === 'permissions' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-[15px] font-display font-semibold">Permission Model</h3>
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    Strict multi-tenant isolation. Workspace Owners and YBS Trainers operate with defined boundary permissions.
                  </p>
                </div>
                <div className="space-y-2">
                  {[
                    { role: 'Platform Owner', desc: 'Full cross-workspace authority, provisioning, and capacity overrides' },
                    { role: 'Workspace Owner', desc: 'Full operational access within their isolated brand workspace' },
                    { role: 'YBS Trainer', desc: 'Scoped strictly to assigned clients, workout plans, and form reviews' },
                  ].map((r) => (
                    <div key={r.role} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border">
                      <div>
                        <span className="text-[13px] font-medium text-foreground">{r.role}</span>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{r.desc}</p>
                      </div>
                      <Badge variant="outline" className="text-primary border-primary/20 bg-primary/5">
                        Active
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 6. Notifications */}
            {section === 'notifications' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-[15px] font-display font-semibold">Automated Workspace Notifications</h3>
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    Client follow-up triggers and subscription expiration reminders.
                  </p>
                </div>
                <div className="space-y-2">
                  {[
                    'Follow-up check-in reminders',
                    'Subscription expiring alert (7 days)',
                    'Capacity 90% threshold alert',
                    'Workout and Nutrition plan assignments',
                  ].map((n) => (
                    <div key={n} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border">
                      <span className="text-[13px] text-foreground">{n}</span>
                      <Badge className="text-emerald-400 bg-emerald-500/10 border-emerald-500/20">Enabled</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}