import { supabase } from '@/utils/supabase';

/**
 * Server-side, debounced search across nutrition + workout plan TEMPLATES
 * (PASS 1 "Load Plan" expediter). Returns only templates the caller may
 * read (owner / active-workspace membership scoping is enforced in SQL).
 */
export const PlansService = {
  /**
   * @param {object} opts
   * @param {string}  [opts.query]          - substring search on template name
   * @param {'nutrition'|'workout'|'any'} [opts.source] - template kind
   * @param {string}  [opts.workspaceId]    - caller's active workspace (required for
   *                                          non-platform-owner staff to see globals)
   * @param {number}  [opts.limit]          - 1..50, defaults to 20
   */
  async searchTemplates({ query = '', source = 'any', workspaceId = null, limit = 20 } = {}) {
    const { data, error } = await supabase.rpc('search_plan_templates', {
      p_query: query.trim(),
      p_source: source,
      p_workspace_id: workspaceId || null,
      p_limit: limit,
    });
    if (error) throw error;
    return data || [];
  },

  /**
   * Debounced search helper for UI consumers. Returns a function that
   * cancels the pending timer (call in useEffect cleanup).
   */
  debouncedSearchTemplates(handler, delay = 400, onError) {
    let timer = null;
    const search = (opts) => this.searchTemplates(opts);
    return {
      schedule(opts) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          try {
            handler(await search(opts));
          } catch (err) {
            if (onError) onError(err);
          }
        }, delay);
      },
      cancel() {
        if (timer) clearTimeout(timer);
        timer = null;
      },
    };
  },
};