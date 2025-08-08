// src/routes/debts.js
import express from 'express';
import client from '../db.js';

const router = express.Router();

/*
 Endpoints:
 GET    /         -> listar (opcional ?type=me_deben|yo_debo & ?q=search)
 POST   /         -> crear o sumar si existe (body: { name, amount, type })
 PUT    /:id/increase -> aumentar una deuda (body: { amount })
 PUT    /:id/pay      -> pagar parcialmente (body: { amount })
 PUT    /:id/payall   -> pagar todo (set amount = 0)
 DELETE /:id         -> eliminar registro
 GET    /:id         -> obtener 1 deuda
*/

// Listar (filtro por tipo y búsqueda)
router.get('/', async (req, res) => {
  try {
    const type = req.query.type || 'me_deben';
    const q = req.query.q || '';

    let queryText = 'SELECT * FROM debts WHERE type = $1';
    const params = [type];

    if (q) {
      queryText += ' AND person ILIKE $2';
      params.push(`%${q}%`);
    }

    queryText += ' ORDER BY person ASC';

    const { rows } = await client.query(queryText, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Obtener una deuda
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { rows } = await client.query('SELECT * FROM debts WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Deuda no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Crear o sumar si existe (body: { name, amount, type })
router.post('/', async (req, res) => {
  try {
    const { name, amount, type } = req.body;
    if (!name || amount == null || !type) {
      return res.status(400).json({ error: 'Faltan campos: name, amount, type' });
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'amount inválido' });

    // Buscar registro existente (case-insensitive) y tipo
    const { rows: existing } = await client.query(
      'SELECT * FROM debts WHERE LOWER(person) = LOWER($1) AND type = $2 LIMIT 1',
      [name, type]
    );

    if (existing.length > 0) {
      // Actualizar sumando
      const debt = existing[0];
      const newAmount = parseFloat(debt.amount) + amt;
      const { rows: updatedRows } = await client.query(
        'UPDATE debts SET amount = $1, updated_at = now() WHERE id = $2 RETURNING *',
        [newAmount, debt.id]
      );

      // Registrar transaction
      await client.query(
        'INSERT INTO transactions (debt_id, kind, amount, note) VALUES ($1, $2, $3, $4)',
        [debt.id, 'aumento', amt, 'Aumento mediante API']
      );

      return res.json(updatedRows[0]);
    } else {
      // Crear nuevo registro
      const { rows: createdRows } = await client.query(
        'INSERT INTO debts (person, type, amount) VALUES ($1, $2, $3) RETURNING *',
        [name, type, amt]
      );

      // Registrar transaction de creación
      await client.query(
        'INSERT INTO transactions (debt_id, kind, amount, note) VALUES ($1, $2, $3, $4)',
        [createdRows[0].id, 'creacion', amt, 'Creación mediante API']
      );

      return res.status(201).json(createdRows[0]);
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Aumentar deuda por id (body: { amount })
router.put('/:id/increase', async (req, res) => {
  try {
    const id = req.params.id;
    const { amount } = req.body;
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'amount inválido' });

    // Obtener deuda
    const { rows: debts } = await client.query('SELECT * FROM debts WHERE id = $1', [id]);
    if (debts.length === 0) return res.status(404).json({ error: 'Deuda no encontrada' });

    const debt = debts[0];
    const newAmount = parseFloat(debt.amount) + amt;

    const { rows: updatedRows } = await client.query(
      'UPDATE debts SET amount = $1, updated_at = now() WHERE id = $2 RETURNING *',
      [newAmount, id]
    );

    await client.query(
      'INSERT INTO transactions (debt_id, kind, amount, note) VALUES ($1, $2, $3, $4)',
      [id, 'aumento', amt, 'Aumento por endpoint /increase']
    );

    res.json(updatedRows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Pagar parcialmente (body: { amount })
router.put('/:id/pay', async (req, res) => {
  try {
    const id = req.params.id;
    const { amount } = req.body;
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'amount inválido' });

    const { rows: debts } = await client.query('SELECT * FROM debts WHERE id = $1', [id]);
    if (debts.length === 0) return res.status(404).json({ error: 'Deuda no encontrada' });

    const debt = debts[0];
    const newAmount = Math.max(parseFloat(debt.amount) - amt, 0);

    const { rows: updatedRows } = await client.query(
      'UPDATE debts SET amount = $1, updated_at = now() WHERE id = $2 RETURNING *',
      [newAmount, id]
    );

    await client.query(
      'INSERT INTO transactions (debt_id, kind, amount, note) VALUES ($1, $2, $3, $4)',
      [id, 'pago', amt, 'Pago parcial']
    );

    res.json(updatedRows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Pagar todo (set amount = 0) pero mantener registro
router.put('/:id/payall', async (req, res) => {
  try {
    const id = req.params.id;

    const { rows: debts } = await client.query('SELECT * FROM debts WHERE id = $1', [id]);
    if (debts.length === 0) return res.status(404).json({ error: 'Deuda no encontrada' });

    const debt = debts[0];
    const prevAmount = parseFloat(debt.amount);
    if (prevAmount === 0) return res.status(200).json(debt); // ya estaba 0

    const { rows: updatedRows } = await client.query(
      'UPDATE debts SET amount = 0, updated_at = now() WHERE id = $1 RETURNING *',
      [id]
    );

    await client.query(
      'INSERT INTO transactions (debt_id, kind, amount, note) VALUES ($1, $2, $3, $4)',
      [id, 'pago_total', prevAmount, 'Pago total']
    );

    res.json(updatedRows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Eliminar deuda
router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;

    await client.query('DELETE FROM debts WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
