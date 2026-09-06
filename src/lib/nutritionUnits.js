/**
 * Nutrition Units & Food Reference Gram Equivalency System
 *
 * Provides intelligent, context-aware units per food item (e.g. eggs -> small/medium/large/piece/g;
 * oils -> tsp/tbsp/g; rice -> g/kg/serving; bananas -> small/medium/large/piece/g).
 *
 * The food database stores nutritional values normalized per 100g.
 * This module converts user-chosen units into grams and scales macros accurately.
 */

// ── Context-Aware Unit Definitions & Gram References ──────────────────

/**
 * Common food reference profiles based on USDA & culinary nutrition standards.
 * Each entry defines specific available units and their gram equivalencies.
 */
const FOOD_SPECIFIC_PROFILES = [
  // 1. Whole Eggs / Whites
  {
    id: 'egg_whole',
    match: (name, cat) =>
      (/(whole\s*egg|\beggs?\b|boiled\s*egg|fried\s*egg|scrambled\s*egg)/i.test(name) ||
        /(^|[\s_])(بيض|بيضة)([\s_]|$)/i.test(name)) &&
      !/(egg\s*white|بياض)/i.test(name),
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 10, min: 1, defaultAmount: 100 },
      { id: 'medium', label: 'medium', fullLabel: 'medium (~50g)', gramPerUnit: 50, step: 1, min: 1, defaultAmount: 2, description: '1 medium egg = 50g' },
      { id: 'large', label: 'large', fullLabel: 'large (~60g)', gramPerUnit: 60, step: 1, min: 1, defaultAmount: 2, description: '1 large egg = 60g' },
      { id: 'small', label: 'small', fullLabel: 'small (~40g)', gramPerUnit: 40, step: 1, min: 1, defaultAmount: 2, description: '1 small egg = 40g' },
      { id: 'piece', label: 'piece', fullLabel: 'piece (~50g)', gramPerUnit: 50, step: 1, min: 1, defaultAmount: 2 },
    ],
  },
  {
    id: 'egg_whites',
    match: (name) => /(egg\s*white|بياض\s*بيض)/i.test(name),
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 25, min: 10, defaultAmount: 100 },
      { id: 'medium', label: 'medium', fullLabel: 'medium (~33g)', gramPerUnit: 33, step: 1, min: 1, defaultAmount: 3, description: '1 egg white = ~33g' },
      { id: 'large', label: 'large', fullLabel: 'large (~40g)', gramPerUnit: 40, step: 1, min: 1, defaultAmount: 3, description: '1 large egg white = ~40g' },
      { id: 'piece', label: 'piece', fullLabel: 'piece (~33g)', gramPerUnit: 33, step: 1, min: 1, defaultAmount: 3 },
      { id: 'cup', label: 'cup', fullLabel: 'cup (~240g)', gramPerUnit: 240, step: 0.25, min: 0.25, defaultAmount: 0.5 },
    ],
  },

  // 2. Bananas
  {
    id: 'banana',
    match: (name) => /(banana|موز)/i.test(name),
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 10, min: 10, defaultAmount: 100 },
      { id: 'medium', label: 'medium', fullLabel: 'medium (~118g)', gramPerUnit: 118, step: 1, min: 1, defaultAmount: 1, description: '1 medium banana = 118g' },
      { id: 'small', label: 'small', fullLabel: 'small (~80g)', gramPerUnit: 80, step: 1, min: 1, defaultAmount: 1, description: '1 small banana = 80g' },
      { id: 'large', label: 'large', fullLabel: 'large (~136g)', gramPerUnit: 136, step: 1, min: 1, defaultAmount: 1, description: '1 large banana = 136g' },
      { id: 'piece', label: 'piece', fullLabel: 'piece (~118g)', gramPerUnit: 118, step: 1, min: 1, defaultAmount: 1 },
    ],
  },

  // 3. Apples & Pears
  {
    id: 'apple',
    match: (name) => /(apple|pear|تفاح|كمثرى)/i.test(name),
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 20, min: 10, defaultAmount: 150 },
      { id: 'medium', label: 'medium', fullLabel: 'medium (~182g)', gramPerUnit: 182, step: 1, min: 1, defaultAmount: 1, description: '1 medium apple = 182g' },
      { id: 'small', label: 'small', fullLabel: 'small (~150g)', gramPerUnit: 150, step: 1, min: 1, defaultAmount: 1, description: '1 small apple = 150g' },
      { id: 'large', label: 'large', fullLabel: 'large (~220g)', gramPerUnit: 220, step: 1, min: 1, defaultAmount: 1, description: '1 large apple = 220g' },
      { id: 'piece', label: 'piece', fullLabel: 'piece (~182g)', gramPerUnit: 182, step: 1, min: 1, defaultAmount: 1 },
    ],
  },

  // 4. Oranges & Citrus
  {
    id: 'citrus',
    match: (name) => /(orange|tangerine|mandarin|grapefruit|برتقال|يوسفي|كليمونتين)/i.test(name),
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 20, min: 10, defaultAmount: 130 },
      { id: 'medium', label: 'medium', fullLabel: 'medium (~130g)', gramPerUnit: 130, step: 1, min: 1, defaultAmount: 1 },
      { id: 'small', label: 'small', fullLabel: 'small (~100g)', gramPerUnit: 100, step: 1, min: 1, defaultAmount: 1 },
      { id: 'large', label: 'large', fullLabel: 'large (~180g)', gramPerUnit: 180, step: 1, min: 1, defaultAmount: 1 },
      { id: 'piece', label: 'piece', fullLabel: 'piece (~130g)', gramPerUnit: 130, step: 1, min: 1, defaultAmount: 1 },
    ],
  },

  // 5. Avocado
  {
    id: 'avocado',
    match: (name) => /(avocado|أفوكادو)/i.test(name),
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 10, min: 5, defaultAmount: 50 },
      { id: 'medium', label: 'medium', fullLabel: 'medium (~150g)', gramPerUnit: 150, step: 0.5, min: 0.5, defaultAmount: 0.5, description: '1 whole avocado = 150g' },
      { id: 'small', label: 'small', fullLabel: 'small (~100g)', gramPerUnit: 100, step: 0.5, min: 0.5, defaultAmount: 0.5 },
      { id: 'large', label: 'large', fullLabel: 'large (~200g)', gramPerUnit: 200, step: 0.5, min: 0.5, defaultAmount: 0.5 },
      { id: 'piece', label: 'piece', fullLabel: 'piece (~150g)', gramPerUnit: 150, step: 0.5, min: 0.5, defaultAmount: 1 },
      { id: 'tbsp', label: 'tbsp', fullLabel: 'tbsp (~15g)', gramPerUnit: 15, step: 0.5, min: 0.5, defaultAmount: 1 },
    ],
  },

  // 6. Oils, Liquid Fats & Cooking Spray
  {
    id: 'oils',
    match: (name, cat) =>
      /(oil|olive\s*oil|coconut\s*oil|canola|avocado\s*oil|sesame\s*oil|butter\s*oil|ghee|زيت|سمن)/i.test(name) ||
      (cat === 'fats' && /oil|زيت/i.test(name)),
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 5, min: 1, defaultAmount: 15 },
      { id: 'tbsp', label: 'tbsp', fullLabel: 'tbsp (~14g)', gramPerUnit: 14, step: 0.5, min: 0.5, defaultAmount: 1, description: '1 tbsp oil = 14g' },
      { id: 'tsp', label: 'tsp', fullLabel: 'tsp (~4.5g)', gramPerUnit: 4.5, step: 0.5, min: 0.5, defaultAmount: 1, description: '1 tsp oil = 4.5g' },
    ],
  },

  // 7. Nut Butters & Seed Pastes (Peanut butter, Tahini, Almond butter)
  {
    id: 'nut_butters',
    match: (name) => /(peanut\s*butter|almond\s*butter|tahini|nutella|زبدة\s*فول|طحينة)/i.test(name),
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 5, min: 5, defaultAmount: 32 },
      { id: 'tbsp', label: 'tbsp', fullLabel: 'tbsp (~16g)', gramPerUnit: 16, step: 0.5, min: 0.5, defaultAmount: 1, description: '1 tbsp nut butter = 16g' },
      { id: 'tsp', label: 'tsp', fullLabel: 'tsp (~5.5g)', gramPerUnit: 5.5, step: 0.5, min: 0.5, defaultAmount: 1 },
      { id: 'serving', label: 'serving', fullLabel: 'serving (~32g / 2 tbsp)', gramPerUnit: 32, step: 1, min: 1, defaultAmount: 1 },
    ],
  },

  // 8. Honey & Syrups
  {
    id: 'honey',
    match: (name) => /(honey|maple|syrup|molasses|عسل|دبس)/i.test(name),
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 5, min: 5, defaultAmount: 20 },
      { id: 'tbsp', label: 'tbsp', fullLabel: 'tbsp (~21g)', gramPerUnit: 21, step: 0.5, min: 0.5, defaultAmount: 1, description: '1 tbsp honey = 21g' },
      { id: 'tsp', label: 'tsp', fullLabel: 'tsp (~7g)', gramPerUnit: 7, step: 0.5, min: 0.5, defaultAmount: 1, description: '1 tsp honey = 7g' },
      { id: 'serving', label: 'serving', fullLabel: 'serving (~21g)', gramPerUnit: 21, step: 1, min: 1, defaultAmount: 1 },
    ],
  },

  // 9. Oats & Oatmeal
  {
    id: 'oats',
    match: (name) => /(oat|oatmeal|rolled\s*oats|شوفان)/i.test(name),
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 10, min: 10, defaultAmount: 50 },
      { id: 'cup', label: 'cup', fullLabel: 'cup (~80g dry)', gramPerUnit: 80, step: 0.25, min: 0.25, defaultAmount: 0.5, description: '1 cup dry rolled oats = ~80g' },
      { id: 'serving', label: 'serving', fullLabel: 'serving (~40g)', gramPerUnit: 40, step: 1, min: 1, defaultAmount: 1 },
      { id: 'tbsp', label: 'tbsp', fullLabel: 'tbsp (~10g)', gramPerUnit: 10, step: 1, min: 1, defaultAmount: 3 },
    ],
  },

  // 10. Rice, Pasta, Grains, Quinoa
  {
    id: 'grains_rice',
    match: (name) =>
      /(rice|basmati|jasmine|pasta|spaghetti|macaroni|noodle|quinoa|couscous|bulgur|أرز|رز|مكرونة|باستا|كينوا|برغل)/i.test(name),
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 25, min: 25, defaultAmount: 150 },
      { id: 'kg', label: 'kg', fullLabel: 'kg (kilograms)', gramPerUnit: 1000, step: 0.05, min: 0.05, defaultAmount: 0.2 },
      { id: 'cup', label: 'cup', fullLabel: 'cup cooked (~185g)', gramPerUnit: 185, step: 0.5, min: 0.5, defaultAmount: 1, description: '1 cup cooked rice = ~185g' },
      { id: 'serving', label: 'serving', fullLabel: 'serving (~150g)', gramPerUnit: 150, step: 1, min: 1, defaultAmount: 1 },
    ],
  },

  // 11. Potatoes & Sweet Potatoes
  {
    id: 'potatoes',
    match: (name) => /(potato|sweet\s*potato|بطاطس|بطاطا)/i.test(name),
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 25, min: 25, defaultAmount: 200 },
      { id: 'medium', label: 'medium', fullLabel: 'medium (~170g)', gramPerUnit: 170, step: 1, min: 1, defaultAmount: 1, description: '1 medium potato = 170g' },
      { id: 'large', label: 'large', fullLabel: 'large (~250g)', gramPerUnit: 250, step: 1, min: 1, defaultAmount: 1 },
      { id: 'small', label: 'small', fullLabel: 'small (~120g)', gramPerUnit: 120, step: 1, min: 1, defaultAmount: 1 },
      { id: 'piece', label: 'piece', fullLabel: 'piece (~170g)', gramPerUnit: 170, step: 1, min: 1, defaultAmount: 1 },
      { id: 'serving', label: 'serving', fullLabel: 'serving (~150g)', gramPerUnit: 150, step: 1, min: 1, defaultAmount: 1 },
    ],
  },

  // 12. Bread, Toast, Tortilla, Pita
  {
    id: 'bread',
    match: (name) => /(bread|toast|pita|tortilla|wrap|bagel|خبز|توست|عيش|تورتيلا)/i.test(name),
    units: [
      { id: 'slice', label: 'slice', fullLabel: 'slice (~30g)', gramPerUnit: 30, step: 1, min: 1, defaultAmount: 2, description: '1 slice bread = ~30g' },
      { id: 'piece', label: 'piece', fullLabel: 'piece (~30g)', gramPerUnit: 30, step: 1, min: 1, defaultAmount: 2 },
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 10, min: 10, defaultAmount: 60 },
      { id: 'serving', label: 'serving', fullLabel: 'serving (~30g)', gramPerUnit: 30, step: 1, min: 1, defaultAmount: 2 },
    ],
  },

  // 13. Protein Powders & Supplements
  {
    id: 'protein_powder',
    match: (name) => /(whey|casein|protein\s*powder|isolate|بروتين\s*بودر|واي)/i.test(name),
    units: [
      { id: 'scoop', label: 'scoop', fullLabel: 'scoop (~30g)', gramPerUnit: 30, step: 0.5, min: 0.5, defaultAmount: 1, description: '1 scoop = 30g' },
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 5, min: 5, defaultAmount: 30 },
      { id: 'serving', label: 'serving', fullLabel: 'serving (~30g)', gramPerUnit: 30, step: 1, min: 1, defaultAmount: 1 },
    ],
  },

  // 14. Milk & Liquid Dairy
  {
    id: 'milk',
    match: (name) => /(milk|almond\s*milk|soy\s*milk|oat\s*milk|حليب|لبن)/i.test(name),
    units: [
      { id: 'ml', label: 'ml', fullLabel: 'ml (milliliters)', gramPerUnit: 1.03, step: 50, min: 10, defaultAmount: 200 },
      { id: 'cup', label: 'cup', fullLabel: 'cup (~240ml)', gramPerUnit: 247, step: 0.5, min: 0.5, defaultAmount: 1, description: '1 cup milk = 240ml (~247g)' },
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 50, min: 10, defaultAmount: 200 },
      { id: 'tbsp', label: 'tbsp', fullLabel: 'tbsp (~15ml)', gramPerUnit: 15.5, step: 1, min: 1, defaultAmount: 2 },
    ],
  },

  // 15. Yogurt & Greek Yogurt
  {
    id: 'yogurt',
    match: (name) => /(yogurt|greek\s*yogurt|زبادي|زبادي\s*يوناني|لبنة)/i.test(name),
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 25, min: 25, defaultAmount: 170 },
      { id: 'cup', label: 'cup', fullLabel: 'cup (~225g)', gramPerUnit: 225, step: 0.5, min: 0.5, defaultAmount: 1 },
      { id: 'serving', label: 'serving', fullLabel: 'serving (~170g)', gramPerUnit: 170, step: 1, min: 1, defaultAmount: 1, description: '1 standard tub = 170g' },
      { id: 'tbsp', label: 'tbsp', fullLabel: 'tbsp (~18g)', gramPerUnit: 18, step: 1, min: 1, defaultAmount: 2 },
    ],
  },

  // 16. Cheeses (Cottage cheese, cheddar, mozzarella)
  {
    id: 'cheese',
    match: (name) => /(cheese|cottage|cheddar|mozzarella|parmesan|جبن|جبنة|قريش)/i.test(name),
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 10, min: 10, defaultAmount: 50 },
      { id: 'slice', label: 'slice', fullLabel: 'slice (~28g)', gramPerUnit: 28, step: 1, min: 1, defaultAmount: 2 },
      { id: 'tbsp', label: 'tbsp', fullLabel: 'tbsp (~15g)', gramPerUnit: 15, step: 1, min: 1, defaultAmount: 2 },
      { id: 'cup', label: 'cup', fullLabel: 'cup (~220g)', gramPerUnit: 220, step: 0.5, min: 0.5, defaultAmount: 0.5 },
      { id: 'serving', label: 'serving', fullLabel: 'serving (~30g)', gramPerUnit: 30, step: 1, min: 1, defaultAmount: 1 },
    ],
  },

  // 17. Poultry, Meat, Fish & Seafood
  {
    id: 'meat_poultry_fish',
    match: (name, cat) =>
      /(chicken|breast|thigh|beef|steak|mince|salmon|tuna|tilapia|fish|shrimp|turkey|دجاج|فراخ|صدور|لحم|بقر|سمك|سلمون|تونة|جمبري)/i.test(name) ||
      cat === 'protein',
    units: [
      { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 25, min: 25, defaultAmount: 150 },
      { id: 'kg', label: 'kg', fullLabel: 'kg (kilograms)', gramPerUnit: 1000, step: 0.05, min: 0.05, defaultAmount: 0.2 },
      { id: 'piece', label: 'piece', fullLabel: 'piece / fillet (~150g)', gramPerUnit: 150, step: 1, min: 1, defaultAmount: 1, description: '1 standard breast / fillet = ~150g' },
      { id: 'serving', label: 'serving', fullLabel: 'serving (~120g)', gramPerUnit: 120, step: 1, min: 1, defaultAmount: 1 },
    ],
  },
];

// ── Generic Category Defaults ──────────────────────────────────────────

const CATEGORY_DEFAULT_UNITS = {
  fats: [
    { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 5, min: 1, defaultAmount: 15 },
    { id: 'tbsp', label: 'tbsp', fullLabel: 'tbsp (~14g)', gramPerUnit: 14, step: 0.5, min: 0.5, defaultAmount: 1 },
    { id: 'tsp', label: 'tsp', fullLabel: 'tsp (~4.5g)', gramPerUnit: 4.5, step: 0.5, min: 0.5, defaultAmount: 1 },
    { id: 'serving', label: 'serving', fullLabel: 'serving (~15g)', gramPerUnit: 15, step: 1, min: 1, defaultAmount: 1 },
  ],
  fruits: [
    { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 20, min: 10, defaultAmount: 100 },
    { id: 'medium', label: 'medium', fullLabel: 'medium (~120g)', gramPerUnit: 120, step: 1, min: 1, defaultAmount: 1 },
    { id: 'small', label: 'small', fullLabel: 'small (~80g)', gramPerUnit: 80, step: 1, min: 1, defaultAmount: 1 },
    { id: 'large', label: 'large', fullLabel: 'large (~160g)', gramPerUnit: 160, step: 1, min: 1, defaultAmount: 1 },
    { id: 'piece', label: 'piece', fullLabel: 'piece (~120g)', gramPerUnit: 120, step: 1, min: 1, defaultAmount: 1 },
    { id: 'cup', label: 'cup', fullLabel: 'cup (~150g)', gramPerUnit: 150, step: 0.5, min: 0.5, defaultAmount: 1 },
  ],
  vegetables: [
    { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 25, min: 10, defaultAmount: 100 },
    { id: 'cup', label: 'cup', fullLabel: 'cup chopped (~75g)', gramPerUnit: 75, step: 0.5, min: 0.5, defaultAmount: 1 },
    { id: 'piece', label: 'piece', fullLabel: 'piece (~100g)', gramPerUnit: 100, step: 1, min: 1, defaultAmount: 1 },
    { id: 'serving', label: 'serving', fullLabel: 'serving (~85g)', gramPerUnit: 85, step: 1, min: 1, defaultAmount: 1 },
  ],
  protein: [
    { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 25, min: 25, defaultAmount: 150 },
    { id: 'kg', label: 'kg', fullLabel: 'kg (kilograms)', gramPerUnit: 1000, step: 0.05, min: 0.05, defaultAmount: 0.2 },
    { id: 'piece', label: 'piece', fullLabel: 'piece (~150g)', gramPerUnit: 150, step: 1, min: 1, defaultAmount: 1 },
    { id: 'serving', label: 'serving', fullLabel: 'serving (~120g)', gramPerUnit: 120, step: 1, min: 1, defaultAmount: 1 },
  ],
  carbs: [
    { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 25, min: 25, defaultAmount: 150 },
    { id: 'kg', label: 'kg', fullLabel: 'kg (kilograms)', gramPerUnit: 1000, step: 0.05, min: 0.05, defaultAmount: 0.2 },
    { id: 'cup', label: 'cup', fullLabel: 'cup (~180g)', gramPerUnit: 180, step: 0.5, min: 0.5, defaultAmount: 1 },
    { id: 'serving', label: 'serving', fullLabel: 'serving (~100g)', gramPerUnit: 100, step: 1, min: 1, defaultAmount: 1 },
  ],
  dairy: [
    { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 25, min: 10, defaultAmount: 150 },
    { id: 'cup', label: 'cup', fullLabel: 'cup (~240g)', gramPerUnit: 240, step: 0.5, min: 0.5, defaultAmount: 1 },
    { id: 'serving', label: 'serving', fullLabel: 'serving (~150g)', gramPerUnit: 150, step: 1, min: 1, defaultAmount: 1 },
    { id: 'tbsp', label: 'tbsp', fullLabel: 'tbsp (~15g)', gramPerUnit: 15, step: 1, min: 1, defaultAmount: 2 },
  ],
  beverages: [
    { id: 'ml', label: 'ml', fullLabel: 'ml (milliliters)', gramPerUnit: 1, step: 50, min: 10, defaultAmount: 250 },
    { id: 'cup', label: 'cup', fullLabel: 'cup (~240ml)', gramPerUnit: 240, step: 0.5, min: 0.5, defaultAmount: 1 },
    { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 50, min: 10, defaultAmount: 250 },
    { id: 'serving', label: 'serving', fullLabel: 'serving (~250ml)', gramPerUnit: 250, step: 1, min: 1, defaultAmount: 1 },
  ],
};

const UNIVERSAL_FALLBACK_UNITS = [
  { id: 'g', label: 'g', fullLabel: 'g (grams)', gramPerUnit: 1, step: 10, min: 1, defaultAmount: 100 },
  { id: 'kg', label: 'kg', fullLabel: 'kg (kilograms)', gramPerUnit: 1000, step: 0.05, min: 0.05, defaultAmount: 0.1 },
  { id: 'serving', label: 'serving', fullLabel: 'serving', gramPerUnit: 100, step: 1, min: 1, defaultAmount: 1 },
];

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Returns an intelligent, context-aware list of unit options for a given food.
 *
 * @param {Object} food - The food object (name, name_ar, category, serving_unit, serving_size)
 * @returns {Array<Object>} List of unit objects { id, label, fullLabel, gramPerUnit, step, min, defaultAmount }
 */
export function getAvailableUnitsForFood(food) {
  if (!food) return UNIVERSAL_FALLBACK_UNITS;

  const name = [food.name, food.name_ar, ...(food.aliases || [])].filter(Boolean).join(' ');
  const cat = (food.category || '').toLowerCase();

  // 1. Try food-specific match
  for (const profile of FOOD_SPECIFIC_PROFILES) {
    if (profile.match(name, cat)) {
      return sanitizeUnitList(profile.units, food);
    }
  }

  // 2. Try category defaults
  if (cat && CATEGORY_DEFAULT_UNITS[cat]) {
    return sanitizeUnitList(CATEGORY_DEFAULT_UNITS[cat], food);
  }

  // 3. Universal fallback
  return sanitizeUnitList(UNIVERSAL_FALLBACK_UNITS, food);
}

/**
 * Ensures 'g' is present and adds any custom food serving unit from the database
 * if not already included.
 */
function sanitizeUnitList(units, food) {
  const result = [...units];

  // If the food has a custom serving_unit in DB like 'can' or 'scoop' or 'slice' that isn't in list:
  const dbUnit = (food?.serving_unit || '').trim().toLowerCase();
  const dbServingSize = Number(food?.serving_size) > 0 ? Number(food.serving_size) : 100;

  if (dbUnit && dbUnit !== 'g' && dbUnit !== '100g' && dbUnit !== 'gram' && dbUnit !== 'grams') {
    const existing = result.find((u) => u.id.toLowerCase() === dbUnit);
    if (!existing) {
      result.push({
        id: dbUnit,
        label: dbUnit,
        fullLabel: `${dbUnit} (~${dbServingSize}g)`,
        gramPerUnit: dbServingSize,
        step: 1,
        min: 0.5,
        defaultAmount: 1,
        description: `Custom food serving = ${dbServingSize}g`,
      });
    }
  }

  return result;
}

/**
 * Resolves a unit configuration for a food by unit ID.
 * Defaults gracefully to 'g' if unit is unknown or omitted.
 */
export function resolveFoodUnit(food, unitId) {
  const available = getAvailableUnitsForFood(food);
  if (!unitId) return available[0];

  const normalized = unitId.trim().toLowerCase();

  // Handle '100g' legacy unit gracefully
  if (normalized === '100g') {
    const gUnit = available.find((u) => u.id === 'g');
    return gUnit || { id: 'g', label: 'g', gramPerUnit: 1, step: 10, min: 1, defaultAmount: 100 };
  }

  const found = available.find((u) => u.id.toLowerCase() === normalized);
  if (found) return found;

  // If not found in intelligent units, create a standard 1:1 fallback
  return {
    id: normalized,
    label: normalized,
    fullLabel: normalized,
    gramPerUnit: 1,
    step: 1,
    min: 0.1,
    defaultAmount: 1,
  };
}

/**
 * Conceptually converts quantity + selected unit into grams, then calculates
 * macros from the base 100g values in the database.
 *
 * Formula:
 * gramEquivalent = amount * unit.gramPerUnit
 * ratio = gramEquivalent / (food.serving_size || 100)
 * nutrient = base_100g_value * ratio
 *
 * @param {Object} food - The base food item from the database (normalized per 100g)
 * @param {number|string} amount - The entered amount
 * @param {string} unitId - The selected unit id (e.g. 'medium', 'g', 'tbsp')
 * @returns {{ calories: number, protein: number, carbs: number, fat: number, gramWeight: number, warning: string|null }}
 */
export function calculateFoodNutrients(food, amount, unitId) {
  const numAmount = Number(amount);

  if (!food) {
    return { calories: 0, protein: 0, carbs: 0, fat: 0, gramWeight: 0, warning: 'No food selected' };
  }

  if (isNaN(numAmount) || numAmount <= 0) {
    return { calories: 0, protein: 0, carbs: 0, fat: 0, gramWeight: 0, warning: 'Enter an amount greater than 0' };
  }

  const unitConfig = resolveFoodUnit(food, unitId);
  const gramWeight = numAmount * (unitConfig.gramPerUnit || 1);

  // Base serving size is 100g in the database standard architecture
  const baseServing = Number(food.serving_size) > 0 ? Number(food.serving_size) : 100;
  const ratio = gramWeight / baseServing;

  return {
    calories: Math.round((Number(food.calories) || 0) * ratio),
    protein: Math.round((Number(food.protein) || 0) * ratio * 10) / 10,
    carbs: Math.round((Number(food.carbs) || 0) * ratio * 10) / 10,
    fat: Math.round((Number(food.fat) || 0) * ratio * 10) / 10,
    gramWeight: Math.round(gramWeight * 10) / 10,
    warning: null,
  };
}

/**
 * Seamlessly converts quantity when the user switches units in the UI dropdown.
 *
 * Example:
 * 200g of Egg switched to 'medium' (50g) -> converts to 4 medium eggs.
 * 4 medium eggs switched to 'g' -> converts to 200g.
 * 1 tbsp oil (14g) switched to 'tsp' (4.5g) -> converts to 3 tsp.
 */
export function convertQuantityBetweenUnits(fromUnitId, toUnitId, currentAmount, food) {
  if (fromUnitId === toUnitId) return currentAmount;

  const numAmount = Number(currentAmount);
  const fromConfig = resolveFoodUnit(food, fromUnitId);
  const toConfig = resolveFoodUnit(food, toUnitId);

  if (isNaN(numAmount) || numAmount <= 0) {
    return toConfig.defaultAmount || 1;
  }

  // Calculate current grams
  const currentGrams = numAmount * (fromConfig.gramPerUnit || 1);

  // Convert to target units
  const targetUnits = currentGrams / (toConfig.gramPerUnit || 1);

  // Round intelligently to target step
  if (toConfig.step >= 1) {
    // Integer units like eggs, slices, pieces
    return Math.max(toConfig.min || 1, Math.round(targetUnits));
  } else if (toConfig.step >= 0.1) {
    return Math.max(toConfig.min || 0.1, Math.round(targetUnits * 10) / 10);
  } else {
    return Math.max(toConfig.min || 0.01, Math.round(targetUnits * 100) / 100);
  }
}

/**
 * Returns a clean display string for the gram equivalent if the unit is not grams.
 * e.g. "4 medium (~200g)" or "~200g"
 */
export function getGramEquivalentText(amount, unitId, food) {
  const normalized = (unitId || 'g').trim().toLowerCase();
  if (normalized === 'g' || normalized === '100g') return null;

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) return null;

  const unitConfig = resolveFoodUnit(food, unitId);
  const totalGrams = Math.round(numAmount * (unitConfig.gramPerUnit || 1));

  return `~${totalGrams}g`;
}
