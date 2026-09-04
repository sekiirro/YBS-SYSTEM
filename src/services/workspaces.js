import { supabase } from '@/utils/supabase';

export const WorkspacesService = {
  async list() {
    // Attempt high-performance aggregated overview query first
    const { data: rpcData, error: rpcError } = await supabase
      .rpc('get_workspaces_overview');

    if (!rpcError && rpcData) {
      return rpcData;
    }

    // Fallback: standard select with partnership_types join
    const { data, error } = await supabase
      .from('workspaces')
      .select('*, partnership_types(*)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('workspaces')
      .select('*, partnership_types(*)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async getCapacityStats(workspaceId) {
    if (!workspaceId) return null;

    const [wsRes, clientsRes, trainersRes] = await Promise.all([
      supabase
        .from('workspaces')
        .select('id, name, client_capacity, partnership_type_id, partnership_types(id, name, code)')
        .eq('id', workspaceId)
        .single(),
      supabase
        .from('clients')
        .select('id, status, assigned_ybs_coach_id')
        .eq('workspace_id', workspaceId),
      supabase
        .from('client_ybs_trainer_assignments')
        .select('trainer_id')
        .eq('is_active', true)
        .in('client_id', (
          await supabase.from('clients').select('id').eq('workspace_id', workspaceId)
        ).data?.map(c => c.id) || []),
    ]);

    if (wsRes.error) throw wsRes.error;
    const ws = wsRes.data;
    const clients = clientsRes.data || [];
    const assignments = trainersRes.data || [];

    const activeCount = clients.filter(c => c.status === 'active').length;
    const totalCount = clients.length;
    const capacity = ws.client_capacity; // NULL means unlimited

    // Derived distinct trainers
    const trainerIds = new Set([
      ...clients.map(c => c.assigned_ybs_coach_id).filter(Boolean),
      ...assignments.map(a => a.trainer_id).filter(Boolean),
    ]);

    const isUnlimited = capacity === null || capacity === undefined;
    const utilizationPct = !isUnlimited && capacity > 0
      ? Math.round((activeCount / capacity) * 100)
      : 0;

    const isWarning = !isUnlimited && utilizationPct >= 90 && utilizationPct < 100;
    const isAtCapacity = !isUnlimited && activeCount >= capacity;

    return {
      workspaceId,
      workspaceName: ws.name,
      capacity,
      isUnlimited,
      activeCount,
      totalCount,
      assignedTrainersCount: trainerIds.size,
      utilizationPct,
      isWarning,
      isAtCapacity,
      partnershipType: ws.partnership_types,
    };
  },

  async create(payload) {
    const { data, error } = await supabase
      .from('workspaces')
      .insert(payload)
      .select('*, partnership_types(*)')
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('workspaces')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, partnership_types(*)')
      .single();
    if (error) throw error;
    return data;
  },

  async toggleStatus(id, currentStatus) {
    const nextStatus = currentStatus === 'active' ? 'suspended' : 'active';
    return this.update(id, { status: nextStatus });
  }
};

