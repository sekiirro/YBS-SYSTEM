import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { NutritionService } from '@/services/nutrition';
import { MealReplacementRequestsService } from '@/services/mealReplacementRequests';
import { supabase } from '@/utils/supabase';
import ClientEmptyState from '@/components/portal/ClientEmptyState';
import CinematicPortalNav from '@/components/portal/CinematicPortalNav';
import MealReplacementRequestModal from '@/components/nutrition/MealReplacementRequestModal';
import { ErrorState, LoadingState } from '@/components/ui';
import { getDisplayFoodUnit } from '@/lib/nutritionUnits';
import { getLocalDateKey } from '@/lib/ybs-utils';
import { Apple, ArrowLeftRight, Check, ChevronDown, ChevronRight, MessageSquare, Utensils } from 'lucide-react';

const MEAL_IMAGES = ['/images/nutrition/meal-breakfast.png', '/images/nutrition/meal-chicken.png', '/images/nutrition/meal-smoothie.png', '/images/nutrition/meal-salmon.png'];
const sumItems = (items = []) => items.reduce((sum, item) => ({ calories: sum.calories + (+item.calories || 0), protein: sum.protein + (+item.protein || 0), carbs: sum.carbs + (+item.carbs || 0), fat: sum.fat + (+item.fat || 0) }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
const round = (value) => Math.round((+value || 0) * 10) / 10;

export default function ClientNutrition() {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [plans, setPlans] = useState([]);
  const [activePlan, setActivePlan] = useState(null);
  const [requests, setRequests] = useState([]);
  const [dailyLogs, setDailyLogs] = useState([]);
  const [requestModalMeal, setRequestModalMeal] = useState(null);
  const [selectedMealId, setSelectedMealId] = useState(null);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateKey(new Date()));
  const [logging, setLogging] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');

  const loadData = useCallback(async () => {
    if (!user?.self_client_id) { setLoading(false); return; }
    try {
      setLoading(true); setLoadError(false);
      const end = new Date(); const start = new Date(); start.setDate(end.getDate() - 6);
      const [list, reqs, logs] = await Promise.all([
        NutritionService.list({ client_id: user.self_client_id }),
        MealReplacementRequestsService.listForClient(user.self_client_id).catch(() => []),
        NutritionService.getWeeklyNutritionLogs(user.self_client_id, getLocalDateKey(start), getLocalDateKey(end)).catch(() => []),
      ]);
      setPlans(list || []); setActivePlan((current) => list?.find((plan) => plan.id === current?.id) || list?.[0] || null);
      setRequests(reqs || []); setDailyLogs(logs || []);
    } catch (error) { setLoadError(true); console.error('Error loading client nutrition:', error); }
    finally { setLoading(false); }
  }, [user?.self_client_id]);
  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    if (!user?.active_workspace_id) return;
    supabase.from('workspaces').select('name').eq('id', user.active_workspace_id).maybeSingle().then(({ data }) => setWorkspaceName(data?.name || '')).catch(() => {});
  }, [user?.active_workspace_id]);

  const refreshRequests = useCallback(async () => {
    if (!user?.self_client_id) return;
    try { setRequests(await MealReplacementRequestsService.listForClient(user.self_client_id) || []); }
    catch (error) { console.error('Failed to refresh replacement requests:', error); }
  }, [user?.self_client_id]);

  const meals = useMemo(() => activePlan?.meals || [], [activePlan]);
  useEffect(() => {
    if (!meals.length) return;
    setSelectedMealId((current) => current && meals.some((meal) => meal.id === current) ? current : null);
    setSelectedItemId(null);
  }, [meals]);

  const selectedMeal = meals.find((meal) => meal.id === selectedMealId) || null;
  const selectedItems = selectedMeal?.items || selectedMeal?.nutrition_items || [];
  const selectedItem = selectedItems.find((item) => item.id === selectedItemId) || null;
  const selection = selectedItem ? { label: selectedItem.food_name || 'Food item', ...sumItems([selectedItem]) }
    : selectedMeal ? { label: selectedMeal.meal_name || 'Selected meal', ...sumItems(selectedItems) }
      : { label: 'Daily target', calories: +activePlan?.daily_calories || 0, protein: +activePlan?.daily_protein || 0, carbs: +activePlan?.daily_carbs || 0, fat: +activePlan?.daily_fat || 0 };
  const pendingByMeal = new Map(requests.filter((request) => request.status === 'pending').map((request) => [request.meal_id, request]));
  const selectedLog = dailyLogs.find((log) => log.log_date === selectedDate);
  const isLogged = Boolean(selectedLog?.meals_completed);
  const todayKey = getLocalDateKey(new Date());
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - (6 - index)); return { key: getLocalDateKey(date), weekday: date.toLocaleDateString('en-US', { weekday: 'short' }), day: date.getDate() }; }), []);

  const handleLog = async () => {
    if (!activePlan || logging || selectedDate > todayKey) return;
    setLogging(true);
    try {
      const log = await NutritionService.logDailyMeals({ clientId: user.self_client_id, workspaceId: activePlan.workspace_id, nutritionPlanId: activePlan.id, date: selectedDate, mealsCompleted: !isLogged, caloriesConsumed: !isLogged ? Math.round(selection.calories) : null, notes: !isLogged ? `Logged from ${selection.label}` : null });
      setDailyLogs((current) => [log, ...current.filter((entry) => entry.log_date !== selectedDate)]);
    } catch (error) { console.error('Failed to update nutrition log:', error); }
    finally { setLogging(false); }
  };

  if (loading) return <LoadingState label="Loading your nutrition plan…" />;
  if (loadError) return <ErrorState onRetry={loadData} />;
  if (!activePlan) return <ClientEmptyState icon={Apple} title="No Nutrition Plan Assigned Yet" description="Your coach hasn't assigned a nutrition plan yet. Your meal breakdown will appear here as soon as it is ready." />;

  const displayName = user?.full_name?.trim() || 'Athlete';
  const initials = displayName.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'C';

  return <div className="nutrition-cinema ybs-cine">
    <CinematicPortalNav workspaceName={workspaceName} initials={initials} displayName={displayName} onSignOut={() => logout()} warmActive />
    <section className="nutrition-cinema__hero">
      <div className="nutrition-cinema__hero-image" aria-hidden="true" />
      <div className="nutrition-cinema__hero-copy"><p>Fuel progress</p><h1>Nutrition</h1><span>Consistent nutrition builds stronger tomorrows.</span></div>
      {plans.length > 1 && <details className="nutrition-plan-picker"><summary><span><small>Active plan</small><strong>{activePlan.name}</strong></span><ChevronDown /></summary><div>{plans.map((plan) => <button type="button" key={plan.id} className={plan.id === activePlan.id ? 'is-active' : ''} onClick={(event) => { setActivePlan(plan); event.currentTarget.closest('details')?.removeAttribute('open'); }}><span>{plan.name}</span>{plan.id === activePlan.id && <Check />}</button>)}</div></details>}
    </section>

    <section className="nutrition-cinema__days" aria-label="Nutrition logging days">
      {days.map((date) => { const logged = dailyLogs.some((entry) => entry.log_date === date.key && entry.meals_completed); return <button key={date.key} type="button" onClick={() => setSelectedDate(date.key)} className={selectedDate === date.key ? 'is-active' : ''}><span>{date.weekday}</span><strong>{date.day}</strong><i className={logged ? 'is-logged' : ''}>{logged ? <Check /> : null}</i></button>; })}
    </section>

    <section className="nutrition-cinema__summary" aria-live="polite">
      <div className="nutrition-cinema__target"><span>{selectedItem ? 'Food focus' : selectedMeal ? 'Meal focus' : 'Today’s plan'}</span><h2>{selection.label}</h2><strong>{Math.round(selection.calories).toLocaleString()} <small>kcal</small></strong><div className="nutrition-cinema__energy"><span style={{ width: `${Math.min(100, (selection.calories / (activePlan.daily_calories || selection.calories || 1)) * 100)}%` }} /></div></div>
      <MacroRing label="Protein" value={selection.protein} target={activePlan.daily_protein} tone="sage" />
      <MacroRing label="Carbs" value={selection.carbs} target={activePlan.daily_carbs} tone="sand" />
      <MacroRing label="Fat" value={selection.fat} target={activePlan.daily_fat} tone="terra" />
    </section>

    {activePlan.notes && <div className="nutrition-cinema__note"><MessageSquare /><p><strong>Coach guidance</strong>{activePlan.notes}</p></div>}
    <div className="nutrition-cinema__heading"><div><Utensils /><span>Today’s meals</span></div><small>{meals.length} scheduled meals</small></div>
    <section className="nutrition-cinema__meals">
      {meals.map((meal, index) => {
        const items = meal.items || meal.nutrition_items || []; const totals = sumItems(items); const active = meal.id === selectedMeal?.id; const image = meal.image_url || meal.photo_url || MEAL_IMAGES[index % MEAL_IMAGES.length];
        return <article key={meal.id || index} className={`nutrition-meal ${active ? 'is-active' : ''}`}>
          <button type="button" className="nutrition-meal__summary" onClick={() => { setSelectedMealId(active ? null : meal.id); setSelectedItemId(null); }} aria-expanded={active}>
            {!active && <img src={image} alt="" />}<span className="nutrition-meal__time">Meal {index + 1}</span><span className="nutrition-meal__title"><strong>{meal.meal_name || `Meal ${index + 1}`}</strong><small>{items.length} foods · {Math.round(totals.calories)} kcal · {round(totals.protein)}P / {round(totals.carbs)}C / {round(totals.fat)}F</small></span><span className="nutrition-meal__state">{pendingByMeal.has(meal.id) ? 'Request pending' : active ? 'Viewing' : 'Details'}</span><ChevronRight />
          </button>
          {active && <div className="nutrition-meal__detail">
            <aside className="nutrition-meal__aside"><img src={image} alt="" /><div><MessageSquare /><p><strong>Coach notes</strong>{meal.notes || activePlan.notes || 'Follow the assigned portions and meal timing for today.'}</p></div></aside>
            <div className="nutrition-meal__content"><div className="nutrition-meal__items">{items.map((item, itemIndex) => <button key={item.id || itemIndex} type="button" onClick={() => setSelectedItemId(item.id)} className={selectedItemId === item.id ? 'is-active' : ''}><span><strong>{item.food_name || 'Food item'}</strong><small>{item.amount} {getDisplayFoodUnit(item.unit)}</small></span><span><b>{Math.round(item.calories || 0)} kcal</b><small>{round(item.protein)}P · {round(item.carbs)}C · {round(item.fat)}F</small></span></button>)}</div>
            <div className="nutrition-meal__actions"><button type="button" className={`nutrition-meal__log ${isLogged ? 'is-logged' : ''}`} onClick={handleLog} disabled={logging || selectedDate > todayKey}><Check /> {logging ? 'Saving…' : isLogged ? 'Logged for this day' : 'Log this meal'}</button><button type="button" className="nutrition-meal__replace" onClick={() => setRequestModalMeal(meal)} disabled={!items.length}><ArrowLeftRight /> Request replacement</button></div></div>
          </div>}
        </article>;
      })}
    </section>
    <MealReplacementRequestModal open={requestModalMeal !== null} onClose={() => setRequestModalMeal(null)} meal={requestModalMeal} planId={activePlan.id} workspaceId={activePlan.workspace_id} clientId={user?.self_client_id} requestedById={user?.id} pendingRequests={requests.filter((request) => request.status === 'pending')} onSubmitted={refreshRequests} />
  </div>;
}

function MacroRing({ label, value, target, tone }) {
  const progress = Math.min(100, Math.round(((+value || 0) / (+target || +value || 1)) * 100));
  return <div className={`nutrition-ring nutrition-ring--${tone}`}><div style={{ '--progress': `${progress * 3.6}deg` }}><span>{progress}%</span></div><p><span>{label}</span><strong>{round(value)}g</strong><small>/ {round(target)}g</small></p></div>;
}
