/**
 * Regression — canonical unit-aware nutrient scaling
 * (src/lib/nutritionUnits.js → calculateFoodNutrients).
 *
 * Guards the unit-blind scaling bug fixed in src/pages/NutritionPlanBuilder.jsx:
 * the quantity/unit change handler scaled with
 *     factor = amount / baseFood.serving_size          (unit IGNORED)
 * so "Egg, 3, medium" (gramWeight 150 g via medium gramPerUnit 50) showed
 * ~4 kcal instead of ~215 kcal. The fix routes that mutation through the same
 * canonical helper used everywhere else (MealSection row, FoodPickerModal,
 * BulkFoodPickerModal, foodReplacementCore, food scale input).
 *
 * Canonical contract (matches what the UI renders everywhere): calories →
 * integer (Math.round), protein/carbs/fat → 1 decimal.
 *
 * Run (no framework — pure ESM, plain node):
 *   node scripts/nutrition-scale-regression.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const libPath = path.join(__dirname, '..', 'src', 'lib', 'nutritionUnits.js');
const { calculateFoodNutrients } = require(libPath);

let failures = 0;
let checks = 0;

function approx(actual, expected, label, tol = 0.2) {
  checks += 1;
  const a = Number(actual);
  const ok = Number.isFinite(a) && Math.abs(a - expected) <= tol;
  if (!ok) {
    failures += 1;
    console.error(`  FAIL  ${label}: got ${a}, expected ~${expected}`);
  } else {
    console.log(`  ok    ${label}: ${a}`);
  }
}

// Base Egg record, canonical per-100g (as stored in DB).
const EGG = {
  name: 'Egg',
  name_ar: 'بيض',
  serving_size: 100,
  serving_unit: 'g',
  calories: 143,
  protein: 12.6,
  carbs: 1.1,
  fat: 9.5,
};

console.log('— Gram path (unchanged) —');
approx(calculateFoodNutrients(EGG, 100, 'g').gramWeight, 100, '100 g gramWeight');
approx(calculateFoodNutrients(EGG, 100, 'g').calories, 143, '100 g cal');
approx(calculateFoodNutrients(EGG, 100, 'g').protein, 12.6, '100 g protein');
approx(calculateFoodNutrients(EGG, 150, 'g').gramWeight, 150, '150 g gramWeight (D)');
approx(calculateFoodNutrients(EGG, 150, 'g').calories, 215, '150 g cal');
approx(calculateFoodNutrients(EGG, 150, 'g').protein, 18.9, '150 g protein');

console.log('— Count-unit aware (medium → 50 g/unit) — THE REPRO —');
approx(calculateFoodNutrients(EGG, 3, 'medium').gramWeight, 150, '(A) 3 medium gramWeight');
approx(calculateFoodNutrients(EGG, 3, 'medium').calories, 215, '(A) 3 medium cal — was ~4');
approx(calculateFoodNutrients(EGG, 3, 'medium').protein, 18.9, '(A) 3 medium protein');
approx(calculateFoodNutrients(EGG, 3, 'medium').carbs, 1.7, '(A) 3 medium carbs');
approx(calculateFoodNutrients(EGG, 3, 'medium').fat, 14.3, '(A) 3 medium fat');
approx(calculateFoodNutrients(EGG, 1, 'medium').gramWeight, 50, '(B) 1 medium gramWeight');
approx(calculateFoodNutrients(EGG, 1, 'medium').calories, 72, '(B) 1 medium cal');
approx(calculateFoodNutrients(EGG, 2, 'medium').gramWeight, 100, '(C) 2 medium gramWeight');
approx(calculateFoodNutrients(EGG, 2, 'medium').calories, 143, '(C) 2 medium cal');

console.log('— Decimal quantity (1.5 medium → 75 g) —');
approx(calculateFoodNutrients(EGG, 1.5, 'medium').gramWeight, 75, '(H) 1.5 medium gramWeight');
approx(calculateFoodNutrients(EGG, 1.5, 'medium').calories, 107, '(H) 1.5 medium cal');

console.log('— Unit-agnostic consistency —');
const g1 = calculateFoodNutrients(EGG, 100, 'g');
const m2 = calculateFoodNutrients(EGG, 2, 'medium');
approx(g1.gramWeight, m2.gramWeight, '100 g == 2 medium gramWeight');

console.log('— Zero / invalid guard —');
const zero = calculateFoodNutrients(EGG, 0, 'medium');
approx(zero.calories, 0, 'zero → 0 cal');
approx(zero.gramWeight, 0, 'zero → 0 gramWeight');

if (failures === 0) {
  console.log(`\nALL PASS (${checks} checks) — unit-aware scaling canonical`);
  process.exit(0);
}
console.error(`\n${failures}/${checks} assertions FAILED`);
process.exit(1);
