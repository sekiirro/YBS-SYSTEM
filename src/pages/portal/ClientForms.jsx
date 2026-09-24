import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { AssessmentsService } from '@/services/assessments';
import { supabase } from '@/utils/supabase';
import CinematicPortalNav from '@/components/portal/CinematicPortalNav';
import CinematicFormFiller from '@/components/portal/CinematicFormFiller';
import ClientEmptyState from '@/components/portal/ClientEmptyState';
import { ErrorState, LoadingState } from '@/components/ui';
import { formatDate, getFormStatusLabel } from '@/lib/ybs-utils';
import { ArrowRight, CheckCircle2, ClipboardList } from 'lucide-react';
import formsVideo from '../../../تحريك_صورة_بنفس_حركة_فيديو_20260921221403.mp4';
import answersVideo from '../../../vid2.mp4';

export default function ClientForms() {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [forms, setForms] = useState([]);
  const [focusedId, setFocusedId] = useState(null);
  const [activeForm, setActiveForm] = useState(null);
  const [opening, setOpening] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const videoRef = useRef(null);
  const answerVideoRef = useRef(null);
  const seekRef = useRef({ previousX: null, target: 0, seeking: false });

  const loadForms = useCallback(async () => {
    if (!user?.self_client_id) { setLoading(false); return; }
    try {
      setLoading(true); setLoadError(false);
      const list = await AssessmentsService.list({ client_id: user.self_client_id });
      setForms(list || []); setFocusedId((current) => current || list?.[0]?.id || null);
      const workspaceId = list?.[0]?.workspace_id || user.active_workspace_id;
      if (workspaceId) {
        const { data } = await supabase.from('workspaces').select('name').eq('id', workspaceId).maybeSingle();
        setWorkspaceName(data?.name || '');
      }
    } catch (error) { setLoadError(true); console.error('Error loading client forms:', error); }
    finally { setLoading(false); }
  }, [user?.active_workspace_id, user?.self_client_id]);

  useEffect(() => { loadForms(); }, [loadForms]);
  useEffect(() => {
    const browseVideo = videoRef.current;
    const answerVideo = answerVideoRef.current;
    const video = activeForm ? answerVideo : browseVideo;
    if (!video) return undefined;
    const isCompact = window.matchMedia('(max-width: 900px)').matches;
    if (isCompact) {
      video.play().catch(() => {});
      return undefined;
    }
    browseVideo?.pause(); answerVideo?.pause();
    seekRef.current.previousX = null;
    seekRef.current.target = video.currentTime || 0;
    const seek = () => {
      if (!Number.isFinite(video.duration)) return;
      const state = seekRef.current;
      video.currentTime = Math.max(0, Math.min(video.duration - 0.02, state.target));
      state.seeking = true;
    };
    const move = (event) => {
      const state = seekRef.current;
      if (state.previousX == null) { state.previousX = event.clientX; return; }
      const delta = event.clientX - state.previousX; state.previousX = event.clientX;
      if (!Number.isFinite(video.duration)) return;
      state.target = Math.max(0, Math.min(video.duration - 0.02, state.target + (delta / window.innerWidth) * .8 * video.duration));
      if (!state.seeking) seek();
    };
    const seeked = () => { const state = seekRef.current; state.seeking = false; if (Math.abs(video.currentTime - state.target) > .025) seek(); };
    window.addEventListener('pointermove', move, { passive: true }); video.addEventListener('seeked', seeked);
    return () => { window.removeEventListener('pointermove', move); video.removeEventListener('seeked', seeked); };
  }, [activeForm]);

  const openForm = async (form) => {
    try { setOpening(true); setActiveForm(await AssessmentsService.getById(form.id)); }
    catch (error) { console.error('Failed to open form:', error); }
    finally { setOpening(false); }
  };
  const saveForm = async (assessmentId, responses) => AssessmentsService.saveResponses(assessmentId, responses);
  const submitForm = async (assessmentId, responses) => {
    await AssessmentsService.submitForm(assessmentId, responses, { clientUserId: user.id, coachUserId: activeForm?.assigned_ybs_coach_id, workspaceId: activeForm?.workspace_id, formName: activeForm?.name });
    setActiveForm(null); await loadForms();
  };

  if (loading) return <LoadingState label="Loading your forms…" />;
  if (loadError) return <ErrorState onRetry={loadForms} />;
  const displayName = user?.full_name?.trim() || 'Athlete';
  const initials = displayName.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'C';

  return <main className={`forms-cinema ybs-cine ${activeForm ? 'is-answering' : ''}`}>
    <CinematicPortalNav workspaceName={workspaceName} initials={initials} displayName={displayName} onSignOut={() => logout()} warmActive />
    <div className="forms-cinema__media" aria-hidden="true">
      <video ref={videoRef} className="forms-cinema__video forms-cinema__video--browse" muted playsInline autoPlay loop preload="auto" src={formsVideo} />
      <video ref={answerVideoRef} className="forms-cinema__video forms-cinema__video--answer" muted playsInline autoPlay loop preload="auto" src={answersVideo} />
      <div className="forms-cinema__veil" />
    </div>

    {!activeForm && <section className="forms-cinema__browser">
      {!forms.length ? <ClientEmptyState icon={ClipboardList} title="No Forms Assigned" description="Your next check-in will appear here as soon as your coach sends it." /> : <>
        <div className="forms-cinema__rail" role="list" aria-label="Your forms">
          {forms.map((form, index) => {
            const focused = form.id === focusedId; const pending = form.submission_status === 'pending';
            return <article key={form.id} role="listitem" className={`forms-cinema__card ${focused ? 'is-focused' : 'is-muted'}`} onClick={() => setFocusedId(form.id)}>
              <div className="forms-cinema__ordinal">{String(index + 1).padStart(2, '0')}</div>
              <div><span className="forms-cinema__status">{pending ? 'Awaiting response' : getFormStatusLabel(form.submission_status)}</span><h2>{form.name}</h2><p>{form.due_date ? `Due ${formatDate(form.due_date)}` : pending ? 'Ready when you are.' : form.submitted_at ? `Submitted ${formatDate(form.submitted_at)}` : 'Completed form'}</p></div>
              <button type="button" onClick={(event) => { event.stopPropagation(); openForm(form); }} disabled={opening}>
                <span>{opening && focused ? 'Opening…' : pending ? 'Submit now' : 'View answers'}</span>{pending ? <ArrowRight /> : <CheckCircle2 />}
              </button>
            </article>;
          })}
        </div>
        <p className="forms-cinema__hint"><strong>Forms</strong> — One thoughtful answer at a time.</p>
      </>}
    </section>}

    {activeForm && <CinematicFormFiller assessment={activeForm} onSave={saveForm} onSubmit={submitForm} onClose={() => setActiveForm(null)} />}
  </main>;
}
