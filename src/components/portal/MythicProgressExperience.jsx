import React, { useEffect, useState } from 'react';
import { ArrowRight, Crown, Gem, LockKeyhole, Mountain } from 'lucide-react';
import CinematicPortalNav from '@/components/portal/CinematicPortalNav';
import EvidenceOfAscent from '@/components/portal/EvidenceOfAscent';
import { fmtNum } from '@/lib/body-progress';

const HEROES = [
  { level: 1, name: 'ATLAS', title: 'Bearer of the first burden', video: '/videos/heroes/Atlas.mp4', unlocked: true },
  { level: 5, name: 'ARES', title: 'Discipline made visible', video: '/videos/heroes/Ares.mp4' },
  { level: 10, name: 'APOLLO', title: 'Precision over impulse', video: '/videos/heroes/Apollo.mp4' },
  { level: 15, name: 'HERACLES', title: 'Strength that endured', video: '/videos/heroes/Heracles.mp4' },
  { level: 20, name: 'ZEUS', title: 'Mastery, deliberately rare', video: '/videos/heroes/Zeus.mp4' },
];

const ATLAS_SKILLS = [
  { name: 'The Bearer', basis: 'Atlas bears the heavens without surrender.', reward: 'Redemption unlocks with the first verified milestone.', Icon: Mountain },
  { name: 'Pillar of Endurance', basis: 'The Titan endures what cannot be set down.', reward: 'Redemption unlocks later in the Atlas journey.', Icon: Gem },
  { name: 'Hesperides', basis: 'Atlas guards the golden garden beyond the western edge.', reward: 'Final Atlas redemption remains locked.', Icon: Crown },
];

export default function MythicProgressExperience({ portalNav, displayName, metrics, latest, derivedLatest, workoutLogs, nutritionLogs, onAddCheckIn }) {
  const [screen, setScreen] = useState('select');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [openSkill, setOpenSkill] = useState(null);
  const selected = HEROES[selectedIndex];
  const currentHero = HEROES.find((hero) => hero.unlocked) || HEROES[0];
  const shortName = displayName?.split(' ').filter(Boolean).slice(0, 2).join(' ') || 'Athlete';
  const measurementCount = latest ? ['waist', 'chest', 'hip', 'neck', 'right_arm', 'right_thigh', 'right_calf'].filter((key) => latest[key] != null).length : 0;
  const firstMetric = metrics?.length ? [...metrics].sort((a, b) => new Date(a.entry_date) - new Date(b.entry_date))[0] : null;
  const weightDelta = firstMetric?.weight != null && latest?.weight != null ? Math.round((Number(latest.weight) - Number(firstMetric.weight)) * 10) / 10 : null;
  const realStats = [
    { label: 'BODY COMPOSITION', arabic: 'تكوين الجسم', value: latest?.body_fat != null ? `${fmtNum(latest.body_fat)}%` : derivedLatest?.leanMass != null ? `${derivedLatest.leanMass} kg` : '—', progress: latest?.body_fat != null ? Math.min(100, Math.max(12, Number(latest.body_fat) * 2)) : 12 },
    { label: 'WEIGHT TREND', arabic: 'اتجاه الوزن', value: latest?.weight != null ? `${fmtNum(latest.weight)} kg` : '—', progress: weightDelta == null ? 12 : Math.min(100, 48 + Math.abs(weightDelta) * 5) },
    { label: 'MEASUREMENTS', arabic: 'القياسات المسجلة', value: String(measurementCount), progress: Math.min(100, measurementCount * 14) },
  ];

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [screen]);

  if (screen === 'detail') {
    return <EvidenceOfAscent clientName={shortName} heroName={currentHero.name} videoUrl={currentHero.video} metrics={metrics} workoutLogs={workoutLogs} nutritionLogs={nutritionLogs} onBack={() => setScreen('select')} onCheckIn={onAddCheckIn} />;
  }

  return <div className="mythic-select ybs-cine">
    <CinematicPortalNav {...portalNav} warmActive />
    <div className="mythic-select__atmosphere" aria-hidden="true" />
    <video key={`ambient-${selected.video}`} className="mythic-select__video-ambient" src={selected.video} autoPlay muted loop playsInline preload="auto" aria-hidden="true" />
    <video key={selected.video} className={`mythic-select__video is-${selected.name.toLowerCase()}`} src={selected.video} autoPlay muted loop playsInline preload="auto" aria-hidden="true" />
    <div className="mythic-select__grade" aria-hidden="true" />
    <section className="mythic-roster" aria-label="Hero forms"><p>THE ASCENT</p><div className="mythic-roster__list">
      {HEROES.map((hero, index) => <button type="button" key={hero.name} className={index === selectedIndex ? 'is-selected' : ''} onClick={() => setSelectedIndex(index)} aria-pressed={index === selectedIndex}>
        <span className="mythic-roster__level">{String(hero.level).padStart(2, '0')}</span><span className="mythic-roster__name">{hero.name}</span><span className="mythic-roster__state">{hero.unlocked ? 'AWAKENED' : 'LOCKED'}</span>{!hero.unlocked && <LockKeyhole aria-hidden="true" />}
      </button>)}
    </div></section>
    {!selected.unlocked && <div className="mythic-select__locked" aria-label={`${selected.name} is locked`}><LockKeyhole aria-hidden="true" /><span>FORM LOCKED</span><small>Reach level {selected.level} to awaken</small></div>}
    <section className="mythic-stats" aria-label={`${selected.name} form details`}>
      <div className="mythic-stats__rows">{realStats.map((stat) => <div key={stat.label}><span>{stat.label}<small lang="ar" dir="rtl">{stat.arabic}</small></span><strong>{selected.unlocked ? stat.value : '—'}</strong><i><b style={{ width: selected.unlocked ? `${stat.progress}%` : '6%' }} /></i></div>)}</div>
      <div className="mythic-skills"><p>SKILLS</p><div>{ATLAS_SKILLS.map(({ name, Icon }, index) => <button type="button" key={name} disabled={!selected.unlocked} onClick={() => setOpenSkill(index)} aria-label={selected.unlocked ? `Open ${name} redemption details` : `${selected.name} skill locked`}><Icon aria-hidden="true" /><LockKeyhole className="mythic-skills__lock" aria-hidden="true" /></button>)}</div></div>
    </section>
    <div className="mythic-select__title"><p>LEVEL {String(selected.level).padStart(2, '0')} · {selected.unlocked ? 'AWAKENED' : 'LOCKED'}</p><h1>{selected.name}</h1><span>{selected.title}</span></div>
    <button type="button" className="mythic-enter" onClick={() => setScreen('detail')}><span>Evidence of Ascent</span><ArrowRight aria-hidden="true" /></button>
    {openSkill != null && <div className="mythic-skill-popover" role="dialog" aria-modal="true" aria-label="Skill redemption"><button type="button" className="mythic-skill-popover__close" onClick={() => setOpenSkill(null)}>Close</button><span>ATLAS · SKILL {openSkill + 1}</span><h3>{ATLAS_SKILLS[openSkill].name}</h3><p>{ATLAS_SKILLS[openSkill].basis}</p><div><LockKeyhole aria-hidden="true" /><strong>REDEMPTION LOCKED</strong><small>{ATLAS_SKILLS[openSkill].reward}</small></div></div>}
  </div>;
}
