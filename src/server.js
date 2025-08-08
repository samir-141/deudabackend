// src/index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import debtsRouter from './routes/debts.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Rutas
app.use('/api/debts', debtsRouter);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
