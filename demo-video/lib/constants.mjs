import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEMO_DIR = path.resolve(__dirname, '..');
export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const OUT_DIR = path.join(DEMO_DIR, 'out');
export const SCENES_DIR = path.join(OUT_DIR, 'scenes');
export const CHECKPOINTS_DIR = path.join(OUT_DIR, 'checkpoints');
export const RAW_DIR = path.join(OUT_DIR, 'raw');

export const APP_URL = 'http://localhost:5173';
export const API_URL = 'http://localhost:3000/api';
export const AI_URL = 'http://localhost:8000/python-app';
export const MONGO_EXPRESS_URL = 'http://127.0.0.1:8081';
export const DEMO_DB = 'yantra_demo';
export const DEMO_MONGODB_URI = `mongodb://127.0.0.1:27017/${DEMO_DB}`;

export const VIEWPORT = { width: 1920, height: 1080 };

// Consistent setup constants for Scene 2+ (non-colliding with seeded CS-301..CS-304)
export const DEMO_CLASS = {
  name: 'Third Year C',
  code: 'TE-C',
  year: 'TE',
};

export const DEMO_SUBJECTS = [
  { code: 'CS-311', name: 'Data Structures', credits: 4 },
  { code: 'CS-312', name: 'Operating Systems', credits: 4 },
  { code: 'CS-313', name: 'Database Management', credits: 3 },
];
