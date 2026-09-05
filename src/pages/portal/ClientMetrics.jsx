import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { MetricsService } from '@/services/metrics';
import { ClientsService } from '@/services/clients';
import WeightProgressChart from '@/components/portal/WeightProgressChart';
import ClientEmptyState from '@/components/portal/ClientEmptyState';
import { LoadingState } from '@/components/ui';
import { formatDate } from '@/lib/ybs-utils';
import { TrendingUp, Camera, Image as ImageIcon } from 'lucide-react';

export default function ClientMetrics() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  const loadData = useCallback(async () => {
    if (!user?.self_client_id) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [c, list] = await Promise.all([
        ClientsService.getById(user.self_client_id),
        MetricsService.listByClient(user.self_client_id),
      ]);
      setClient(c);
      setMetrics(list || []);
    } catch (err) {
      console.error('Error loading client metrics:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.self_client_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) return <LoadingState label="Loading your measurements and progress charts…" />;

  const latest = metrics[0] || null;
  const previous = metrics[1] || null;

  // Extract all photos from metric entries
  const allPhotos = [];
  metrics.forEach((m) => {
    if (Array.isArray(m.progress_photos)) {
      m.progress_photos.forEach((p) => {
        allPhotos.push({
          ...p,
          entry_date: m.entry_date,
        });
      });
    }
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="pb-4 border-b border-border/60">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-foreground">
            My Metrics & Progress
          </h1>
        </div>
        <p className="text-[13px] text-muted-foreground mt-1">
          Track body composition changes, circumference measurements, and physique transformation over time.
        </p>
      </div>

      {/* 1. Weight Progress Line Chart */}
      <WeightProgressChart metrics={metrics} client={client} />

      {/* 2. Latest Body Measurements Grid */}
      {latest && (
        <div>
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground font-display">
              Latest Circumference Measurements
            </h2>
            <span className="text-xs text-muted-foreground font-mono">
              Recorded {formatDate(latest.entry_date)}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Body Fat', value: latest.body_fat ? `${latest.body_fat}%` : null, prev: previous?.body_fat },
              { label: 'Waist', value: latest.waist ? `${latest.waist} cm` : null, prev: previous?.waist },
              { label: 'Chest', value: latest.chest ? `${latest.chest} cm` : null, prev: previous?.chest },
              { label: 'Arm (R)', value: latest.right_arm ? `${latest.right_arm} cm` : null, prev: previous?.right_arm },
              { label: 'Thigh (R)', value: latest.right_thigh ? `${latest.right_thigh} cm` : null, prev: previous?.right_thigh },
              { label: 'Neck', value: latest.neck ? `${latest.neck} cm` : null, prev: previous?.neck },
              { label: 'Hips', value: latest.hip ? `${latest.hip} cm` : null, prev: previous?.hip },
              { label: 'Calf (R)', value: latest.right_calf ? `${latest.right_calf} cm` : null, prev: previous?.right_calf },
            ]
              .filter((item) => item.value != null)
              .map((item) => (
                <div key={item.label} className="surface-card p-4 rounded-xl border border-border/80">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground block">{item.label}</span>
                  <p className="text-base font-bold text-foreground font-mono mt-1">{item.value}</p>
                  {item.prev != null && (
                    <span className="text-[11px] text-muted-foreground/80 font-mono mt-0.5 block">
                      Prev: {item.prev}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 3. Progress Photos Gallery */}
      <div>
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground font-display flex items-center gap-1.5">
            <Camera className="w-4 h-4 text-primary" /> Progress Photos
          </h2>
        </div>

        {allPhotos.length === 0 ? (
          <ClientEmptyState
            icon={ImageIcon}
            title="No Progress Photos Yet"
            description="Your physique check-in photos will appear securely in this gallery once uploaded during check-ins."
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {allPhotos.map((photo, idx) => (
              <div
                key={photo.id || idx}
                onClick={() => setSelectedPhoto(photo)}
                className="surface-card rounded-xl overflow-hidden border border-border/80 group cursor-pointer hover:border-primary/50 transition-all aspect-[3/4] relative bg-black/40"
              >
                {photo.signed_url ? (
                  <img
                    src={photo.signed_url}
                    alt={`${photo.angle || 'Progress'} photo`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <ImageIcon className="w-8 h-8" />
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                  <span className="text-[10px] font-semibold text-white uppercase tracking-wider block capitalize">
                    {photo.angle || 'Photo'}
                  </span>
                  <span className="text-[10px] text-gray-300 font-mono">
                    {formatDate(photo.entry_date || photo.captured_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Measurement Log History Table */}
      <div>
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground font-display">
            Measurement Log History
          </h2>
        </div>

        {metrics.length === 0 ? (
          <ClientEmptyState
            icon={TrendingUp}
            title="No History Entries"
            description="No measurements recorded yet. Entries will be chronologically listed here."
          />
        ) : (
          <div className="surface-card rounded-xl overflow-hidden border border-border/80">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/80 bg-secondary/30">
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Date</th>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Weight</th>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Body Fat</th>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Waist</th>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Chest</th>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Arms</th>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 font-mono">
                  {metrics.map((m) => (
                    <tr key={m.id} className="hover:bg-secondary/20 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{formatDate(m.entry_date)}</td>
                      <td className="px-4 py-3 text-primary font-bold">{m.weight ? `${m.weight} kg` : '—'}</td>
                      <td className="px-4 py-3 text-foreground">{m.body_fat ? `${m.body_fat}%` : '—'}</td>
                      <td className="px-4 py-3 text-foreground">{m.waist ? `${m.waist} cm` : '—'}</td>
                      <td className="px-4 py-3 text-foreground">{m.chest ? `${m.chest} cm` : '—'}</td>
                      <td className="px-4 py-3 text-foreground">
                        {m.right_arm ? `${m.right_arm} cm` : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-sans text-[11px] max-w-xs truncate">
                        {m.notes || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Lightbox Photo Modal */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setSelectedPhoto(null)}
        >
          <div className="max-w-md w-full surface-card p-3 rounded-2xl border border-border" onClick={(e) => e.stopPropagation()}>
            {selectedPhoto.signed_url && (
              <img
                src={selectedPhoto.signed_url}
                alt="Progress Photo"
                className="w-full rounded-xl max-h-[75vh] object-contain mx-auto"
              />
            )}
            <div className="p-3 text-center">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary capitalize block">
                {selectedPhoto.angle || 'Progress'} Photo
              </span>
              <span className="text-xs text-muted-foreground font-mono mt-0.5 block">
                {formatDate(selectedPhoto.entry_date || selectedPhoto.captured_at)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
