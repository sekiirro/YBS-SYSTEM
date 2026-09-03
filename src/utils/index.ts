export function createPageUrl(pageName: string) {
    return '/' + pageName.replace(/ /g, '-');
}

export { supabase } from './supabase';