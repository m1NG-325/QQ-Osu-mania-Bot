import { analysisLane } from './runtime.js';
import { analyzeText as analyze } from './analysis.js';
import { modStars as stars, mapPerformance as performance } from './difficulty.js';
import { danContribution as dan } from './dan.js';
export const analyzeText = (...args) => analysisLane.run(() => analyze(...args));
export const modStars = (...args) => analysisLane.run(() => stars(...args));
export const mapPerformance = (...args) => analysisLane.run(() => performance(...args));
export const danContribution = (...args) => analysisLane.run(() => dan(...args));
