import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { AssessmentsService } from '@/services/assessments';
import FormFiller from '@/components/FormFiller';
import ClientEmptyState from '@/components/portal/ClientEmptyState';
import { LoadingState, Button, Badge } from '@/components/ui';
import { formatDate, getFormStatusColor } from '@/lib/ybs-utils';
import { ClipboardList, Clock, CheckCircle2, Eye, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ClientForms() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState([]);
  const [statusTab, setStatusTab] = useState('all'); // 'all' | 'pending' | 'submitted' | 'reviewed'
  const [activeForm, setActiveForm] = useState(null);

  const loadForms = useCallback(async () => {
    if (!user?.self_client_id) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const list = await AssessmentsService.list({ client_id: user.self_client_id });
      setForms(list || []);
    } catch (err) {
      console.error('Error loading client forms:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.self_client_id]);

  useEffect(() => {
    loadForms();
  }, [loadForms]);

  const filteredForms = useMemo(() => {
    if (statusTab === 'all') return forms;
    if (statusTab === 'pending') return forms.filter((f) => f.submission_status === 'pending');
    if (statusTab === 'submitted') return forms.filter((f) => f.submission_status === 'submitted');
    if (statusTab === 'reviewed') return forms.filter((f) => f.submission_status === 'reviewed');
    return forms;
  }, [forms, statusTab]);

  const handleOpenForm = async (f) => {
    try {
      const full = await AssessmentsService.getById(f.id);
      setActiveForm(full);
    } catch (err) {
      console.error('Failed to open form:', err);
    }
  };

  const handleSaveForm = async (assessmentId, responses) => {
    await AssessmentsService.saveResponses(assessmentId, responses);
    const full = await AssessmentsService.getById(assessmentId);
    setActiveForm(full);
  };

  const handleSubmitForm = async (assessmentId, responses) => {
    await AssessmentsService.submitForm(assessmentId, responses, {
      clientUserId: user.id,
      coachUserId: activeForm?.assigned_ybs_coach_id,
      workspaceId: activeForm?.workspace_id,
      formName: activeForm?.name,
    });
    await loadForms();
    setActiveForm(null);
  };

  if (loading) return <LoadingState label="Loading your check-ins and forms…" />;

  const pendingCount = forms.filter((f) => f.submission_status === 'pending').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary" />
            <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-foreground">
              My Forms & Check-ins
            </h1>
          </div>
          <p className="text-[13px] text-muted-foreground mt-1">
            Complete scheduled check-ins so your coach can analyze your progress and calibrate your plans.
          </p>
        </div>

        {/* Status filter tabs */}
        <div className="flex items-center gap-1 bg-secondary/40 p-1 rounded-lg border border-border/60 self-start sm:self-auto">
          {[
            { id: 'all', label: 'All', count: forms.length },
            { id: 'pending', label: 'Pending', count: pendingCount },
            { id: 'submitted', label: 'Under Review', count: forms.filter((f) => f.submission_status === 'submitted').length },
            { id: 'reviewed', label: 'Reviewed', count: forms.filter((f) => f.submission_status === 'reviewed').length },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusTab(tab.id)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5',
                statusTab === tab.id
                  ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span>{tab.label}</span>
              <span className={cn('text-[10px] px-1 rounded-full', statusTab === tab.id ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-secondary text-muted-foreground')}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Forms List */}
      {filteredForms.length === 0 ? (
        <ClientEmptyState
          icon={ClipboardList}
          title={statusTab === 'all' ? 'No Forms Assigned' : `No ${statusTab} Forms`}
          description={
            statusTab === 'all'
              ? 'You do not have any forms or check-ins scheduled right now. Your coach will notify you when a new check-in is due.'
              : `There are currently no forms in ${statusTab} status.`
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3.5">
          {filteredForms.map((f) => {
            const isPending = f.submission_status === 'pending';
            const isReviewed = f.submission_status === 'reviewed';

            return (
              <div
                key={f.id}
                className="surface-card p-5 rounded-xl border border-border/80 hover:glow-subtle transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-foreground font-display">{f.name}</h3>
                    <Badge className={cn('capitalize text-[11px]', getFormStatusColor(f.submission_status))}>
                      {f.submission_status === 'submitted' ? 'Under Review' : f.submission_status}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
                    {f.due_date && (
                      <span className="flex items-center gap-1 font-mono">
                        <Calendar className="w-3.5 h-3.5" /> Due: {formatDate(f.due_date)}
                      </span>
                    )}
                    {f.submitted_at && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-primary" /> Submitted: {formatDate(f.submitted_at)}
                      </span>
                    )}
                    {f.reviewed_at && (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Reviewed: {formatDate(f.reviewed_at)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                  {isPending ? (
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs h-9 px-4 shadow-sm"
                      onClick={() => handleOpenForm(f)}
                    >
                      Fill Out Check-in
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-9 px-3.5 border-border hover:border-primary/40 text-foreground flex items-center gap-1.5"
                      onClick={() => handleOpenForm(f)}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {isReviewed ? 'View Feedback & Answers' : 'View Answers'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form Filler Modal */}
      {activeForm && (
        <FormFiller
          assessment={activeForm}
          onSave={handleSaveForm}
          onSubmit={handleSubmitForm}
          onClose={() => setActiveForm(null)}
        />
      )}
    </div>
  );
}
