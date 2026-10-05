function mapEdition(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    productCode: row.product_code,
    state: row.state,
    commerceReady: row.commerce_ready,
    editionSize: row.edition_size,
    reservationsClaimed: row.reservations_claimed,
    identityLimit: row.identity_limit,
    identityClaimed: row.identity_claimed,
    reservationPriceCents: row.reservation_price_cents,
    finalPriceCents: row.final_price_cents,
    reservationCreditCents: row.reservation_credit_cents,
    paymentWindowHours: row.payment_window_hours,
    standbyWindowHours: row.standby_window_hours,
  };
}

function mapReservation(row) {
  if (!row) return null;
  return {
    id: row.id,
    editionId: row.edition_id,
    customerId: row.shopify_customer_id,
    shopifyOrderId: row.shopify_order_id,
    status: row.status,
    reservationPaidCents: row.reservation_paid_cents,
    balanceDueCents: row.balance_due_cents,
    referralCode: row.referral_code_used || '',
    collectorReferralCode: row.collector_referral_code,
    lookbookStatus: row.digital_lookbook_status,
    paidAt: row.paid_at,
    finalPaymentOpenedAt: row.final_payment_opened_at,
    paymentDeadline: row.payment_deadline,
    finalPaymentShopifyDraftOrderId: row.final_payment_shopify_draft_order_id,
    finalPaymentUrl: row.final_payment_url,
    finalPaidAt: row.final_paid_at,
    expiredAt: row.expired_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIdentity(row) {
  if (!row) return null;
  return {
    reservationId: row.reservation_id,
    editionId: row.edition_id,
    source: row.source,
    status: row.status,
    alias: row.alias || '',
    inscription: row.inscription || '',
    publicIdentity: Boolean(row.public_identity),
    claimedAt: row.claimed_at,
    configuredAt: row.configured_at,
    preferredNumber: row.object_number ?? null,
  };
}

function mapStandby(row) {
  if (!row) return null;
  return {
    id: row.id,
    editionId: row.edition_id,
    customerId: row.shopify_customer_id,
    email: row.email,
    country: row.country || '',
    size: row.size_preference || '',
    sequence: Number(row.sequence),
    status: row.status,
    joinedAt: row.joined_at,
    promotedAt: row.promoted_at,
    offerDeadline: row.offer_deadline,
    convertedOrderId: row.converted_order_id,
  };
}

function translateUnique(error) {
  if (!error || error.code !== '23505') return error;
  const name = String(error.constraint || '');

  if (name === 'reservations_pkey') return new Error('reservation_exists');
  if (name.includes('shopify_order_id')) return new Error('order_already_reserved');
  if (name.includes('shopify_customer_id')) return new Error('customer_already_reserved');
  if (name.includes('collector_referral_code')) return new Error('referral_code_exists');
  if (name.includes('objects_edition_id_object_number')) return new Error('object_number_taken');
  if (name.includes('objects_reservation_id')) return new Error('reservation_already_has_object');
  if (name.includes('referral_conversions_referred_reservation')) return new Error('referral_already_attributed');
  if (name.includes('standby_entries_edition_id_shopify_customer_id')) return new Error('standby_already_joined');

  return error;
}

export class PostgresStore {
  constructor(db) {
    if (!db || typeof db.query !== 'function') {
      throw new Error('PostgresStore requires a pg-compatible pool/client');
    }
    this.db = db;
  }

  async withTransaction(callback) {
    if (typeof this.db.connect !== 'function') {
      await this.db.query('begin');
      try {
        const result = await callback(this.db);
        await this.db.query('commit');
        return result;
      } catch (error) {
        await this.db.query('rollback');
        throw error;
      }
    }

    const client = await this.db.connect();
    try {
      await client.query('begin');
      const result = await callback(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async getEdition(id) {
    const result = await this.db.query(
      'select * from editions where id = $1',
      [id]
    );
    return mapEdition(result.rows[0]);
  }

  async createReservationWithSlot(input) {
    try {
      return await this.withTransaction(async (client) => {
        const editionResult = await client.query(
          'select * from editions where id = $1 for update',
          [input.editionId]
        );
        const edition = editionResult.rows[0];
        if (!edition) throw new Error('edition_not_found');
        if (edition.state !== 'reservation_open' || edition.commerce_ready !== true) {
          throw new Error('reservation_closed');
        }
        if (edition.reservations_claimed >= edition.edition_size) {
          throw new Error('reservation_full');
        }

        const inserted = await client.query(
          `insert into reservations (
            id,
            edition_id,
            shopify_customer_id,
            shopify_order_id,
            status,
            reservation_paid_cents,
            referral_code_used,
            collector_referral_code,
            paid_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          returning *`,
          [
            input.id,
            input.editionId,
            input.customerId,
            input.shopifyOrderId,
            input.status || 'active',
            input.reservationPaidCents,
            input.referralCode || null,
            input.collectorReferralCode,
            input.paidAt,
          ]
        );

        await client.query(
          `update editions
             set reservations_claimed = reservations_claimed + 1,
                 state = case
                   when reservations_claimed + 1 >= edition_size then 'reservation_full'
                   else state
                 end,
                 updated_at = now()
           where id = $1`,
          [input.editionId]
        );

        return mapReservation(inserted.rows[0]);
      });
    } catch (error) {
      throw translateUnique(error);
    }
  }

  async releaseReservationSlot(editionId) {
    const result = await this.db.query(
      `update editions
          set reservations_claimed = greatest(0, reservations_claimed - 1),
              updated_at = now()
        where id = $1
        returning *`,
      [editionId]
    );
    if (!result.rows[0]) throw new Error('edition_not_found');
    return mapEdition(result.rows[0]);
  }

  async getReservation(id) {
    const result = await this.db.query(
      'select * from reservations where id = $1',
      [id]
    );
    return mapReservation(result.rows[0]);
  }

  async findReservationByCollectorReferralCode(editionId, code) {
    const result = await this.db.query(
      `select * from reservations
        where edition_id = $1 and collector_referral_code = $2`,
      [editionId, code]
    );
    return mapReservation(result.rows[0]);
  }

  async findReservationByCustomer(editionId, customerId) {
    const result = await this.db.query(
      `select * from reservations
        where edition_id = $1 and shopify_customer_id = $2`,
      [editionId, customerId]
    );
    return mapReservation(result.rows[0]);
  }

  async updateReservation(id, patch) {
    const columns = {
      status: 'status',
      balanceDueCents: 'balance_due_cents',
      lookbookStatus: 'digital_lookbook_status',
      finalPaymentOpenedAt: 'final_payment_opened_at',
      paymentDeadline: 'payment_deadline',
      finalPaymentShopifyDraftOrderId: 'final_payment_shopify_draft_order_id',
      finalPaymentUrl: 'final_payment_url',
      finalPaidAt: 'final_paid_at',
      expiredAt: 'expired_at',
    };

    const entries = Object.entries(patch)
      .filter(([key]) => Object.prototype.hasOwnProperty.call(columns, key));

    if (!entries.length) return this.getReservation(id);

    const values = [];
    const assignments = entries.map(([key, value], index) => {
      values.push(value);
      return `${columns[key]} = $${index + 1}`;
    });

    values.push(id);
    const result = await this.db.query(
      `update reservations
          set ${assignments.join(', ')}, updated_at = now()
        where id = $${values.length}
        returning *`,
      values
    );

    if (!result.rows[0]) throw new Error('reservation_not_found');
    return mapReservation(result.rows[0]);
  }

  async claimIdentitySlot({ editionId, reservationId, source }) {
    try {
      return await this.withTransaction(async (client) => {
        const existing = await client.query(
          `select i.*, o.object_number
             from identity_privileges i
             left join objects o on o.reservation_id = i.reservation_id
            where i.reservation_id = $1`,
          [reservationId]
        );
        if (existing.rows[0]) return mapIdentity(existing.rows[0]);

        const editionResult = await client.query(
          'select * from editions where id = $1 for update',
          [editionId]
        );
        const edition = editionResult.rows[0];
        if (!edition) throw new Error('edition_not_found');
        if (edition.identity_claimed >= edition.identity_limit) {
          throw new Error('identity_full');
        }

        const inserted = await client.query(
          `insert into identity_privileges (
            reservation_id, edition_id, source, status
          ) values ($1,$2,$3,'claimed')
          returning *`,
          [reservationId, editionId, source]
        );

        await client.query(
          `update editions
              set identity_claimed = identity_claimed + 1,
                  updated_at = now()
            where id = $1`,
          [editionId]
        );

        return mapIdentity(inserted.rows[0]);
      });
    } catch (error) {
      throw translateUnique(error);
    }
  }

  async getIdentityPrivilege(reservationId) {
    const result = await this.db.query(
      `select i.*, o.object_number
         from identity_privileges i
         left join objects o on o.reservation_id = i.reservation_id
        where i.reservation_id = $1`,
      [reservationId]
    );
    return mapIdentity(result.rows[0]);
  }

  async configureIdentityWithObject({
    editionId,
    reservationId,
    number,
    configuration,
  }) {
    try {
      return await this.withTransaction(async (client) => {
        const privilegeResult = await client.query(
          `select * from identity_privileges
            where reservation_id = $1
            for update`,
          [reservationId]
        );
        const privilege = privilegeResult.rows[0];
        if (!privilege) throw new Error('identity_not_claimed');

        const editionResult = await client.query(
          'select edition_size from editions where id = $1',
          [editionId]
        );
        const edition = editionResult.rows[0];
        if (!edition) throw new Error('edition_not_found');

        if (!Number.isInteger(number) || number < 1 || number > edition.edition_size) {
          throw new Error('object_number_out_of_range');
        }

        const existingObject = await client.query(
          `select object_number from objects
            where reservation_id = $1
            for update`,
          [reservationId]
        );

        if (
          existingObject.rows[0] &&
          existingObject.rows[0].object_number !== number
        ) {
          throw new Error('reservation_already_has_object');
        }

        if (!existingObject.rows[0]) {
          await client.query(
            `insert into objects (
              edition_id,
              object_number,
              reservation_id,
              assigned_at
            ) values ($1,$2,$3,now())`,
            [editionId, number, reservationId]
          );
        }

        const updated = await client.query(
          `update identity_privileges
              set alias = $2,
                  inscription = $3,
                  public_identity = $4,
                  status = 'configured',
                  configured_at = now()
            where reservation_id = $1
            returning *`,
          [
            reservationId,
            configuration.alias || '',
            configuration.inscription || '',
            Boolean(configuration.publicIdentity),
          ]
        );

        return mapIdentity({
          ...updated.rows[0],
          object_number: number,
        });
      });
    } catch (error) {
      throw translateUnique(error);
    }
  }

  async configureIdentity(reservationId, configuration) {
    const result = await this.db.query(
      `update identity_privileges
          set alias = $2,
              inscription = $3,
              public_identity = $4,
              status = 'configured',
              configured_at = now()
        where reservation_id = $1
        returning *`,
      [
        reservationId,
        configuration.alias || '',
        configuration.inscription || '',
        Boolean(configuration.publicIdentity),
      ]
    );
    if (!result.rows[0]) throw new Error('identity_not_claimed');

    const objectNumber = await this.getObjectNumberByReservation(reservationId);
    return mapIdentity({ ...result.rows[0], object_number: objectNumber });
  }

  async claimObjectNumber({ editionId, reservationId, number }) {
    const edition = await this.getEdition(editionId);
    if (!edition) throw new Error('edition_not_found');
    if (!Number.isInteger(number) || number < 1 || number > edition.editionSize) {
      throw new Error('object_number_out_of_range');
    }

    const existing = await this.db.query(
      'select object_number from objects where reservation_id = $1',
      [reservationId]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].object_number === number) {
        return { editionId, reservationId, number };
      }
      throw new Error('reservation_already_has_object');
    }

    try {
      await this.db.query(
        `insert into objects (
          edition_id, object_number, reservation_id, assigned_at
        ) values ($1,$2,$3,now())`,
        [editionId, number, reservationId]
      );
      return { editionId, reservationId, number };
    } catch (error) {
      throw translateUnique(error);
    }
  }

  async getObjectNumberByReservation(reservationId) {
    const result = await this.db.query(
      'select object_number from objects where reservation_id = $1',
      [reservationId]
    );
    return result.rows[0]?.object_number ?? null;
  }

  async releaseObjectNumber({ editionId, reservationId }) {
    const result = await this.db.query(
      `delete from objects
        where edition_id = $1 and reservation_id = $2
        returning object_number`,
      [editionId, reservationId]
    );
    return result.rows[0]?.object_number ?? null;
  }

  async verifyReferralAndClaimIdentity({
    editionId,
    referrerReservationId,
    referredReservationId,
  }) {
    try {
      return await this.withTransaction(async (client) => {
        const existingConversion = await client.query(
          `select * from referral_conversions
            where referred_reservation_id = $1
            for update`,
          [referredReservationId]
        );
        if (existingConversion.rows[0]) {
          throw new Error('referral_already_attributed');
        }

        const existingPrivilege = await client.query(
          `select i.*, o.object_number
             from identity_privileges i
             left join objects o on o.reservation_id = i.reservation_id
            where i.reservation_id = $1
            for update of i`,
          [referrerReservationId]
        );

        let privilege = existingPrivilege.rows[0]
          ? mapIdentity(existingPrivilege.rows[0])
          : null;
        let newlyClaimed = false;

        if (!privilege) {
          const editionResult = await client.query(
            'select * from editions where id = $1 for update',
            [editionId]
          );
          const edition = editionResult.rows[0];
          if (!edition) throw new Error('edition_not_found');
          if (edition.identity_claimed >= edition.identity_limit) {
            throw new Error('identity_full');
          }

          const insertedPrivilege = await client.query(
            `insert into identity_privileges (
              reservation_id,
              edition_id,
              source,
              status
            ) values ($1,$2,'referral','claimed')
            returning *`,
            [referrerReservationId, editionId]
          );

          await client.query(
            `update editions
                set identity_claimed = identity_claimed + 1,
                    updated_at = now()
              where id = $1`,
            [editionId]
          );

          privilege = mapIdentity(insertedPrivilege.rows[0]);
          newlyClaimed = true;
        }

        const conversionResult = await client.query(
          `insert into referral_conversions (
            edition_id,
            referrer_reservation_id,
            referred_reservation_id,
            status,
            verified_at
          ) values ($1,$2,$3,'verified',now())
          returning *`,
          [editionId, referrerReservationId, referredReservationId]
        );

        const conversionRow = conversionResult.rows[0];

        return {
          privilege,
          newlyClaimed,
          conversion: {
            referrerReservationId: conversionRow.referrer_reservation_id,
            referredReservationId: conversionRow.referred_reservation_id,
            verifiedAt: conversionRow.verified_at,
            status: conversionRow.status,
          },
        };
      });
    } catch (error) {
      throw translateUnique(error);
    }
  }

  async markReferralConversion({
    referredReservationId,
    referrerReservationId,
    verifiedAt = new Date().toISOString(),
  }) {
    const referred = await this.getReservation(referredReservationId);
    if (!referred) throw new Error('reservation_not_found');

    try {
      const result = await this.db.query(
        `insert into referral_conversions (
          edition_id,
          referrer_reservation_id,
          referred_reservation_id,
          status,
          verified_at
        ) values ($1,$2,$3,'verified',$4)
        returning *`,
        [
          referred.editionId,
          referrerReservationId,
          referredReservationId,
          verifiedAt,
        ]
      );
      const row = result.rows[0];
      return {
        referrerReservationId: row.referrer_reservation_id,
        referredReservationId: row.referred_reservation_id,
        verifiedAt: row.verified_at,
        status: row.status,
      };
    } catch (error) {
      throw translateUnique(error);
    }
  }

  async getReferralConversion(referredReservationId) {
    const result = await this.db.query(
      `select * from referral_conversions
        where referred_reservation_id = $1`,
      [referredReservationId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      referrerReservationId: row.referrer_reservation_id,
      referredReservationId: row.referred_reservation_id,
      verifiedAt: row.verified_at,
      status: row.status,
    };
  }

  async countVerifiedReferrals(referrerReservationId) {
    const result = await this.db.query(
      `select count(*)::int as count
         from referral_conversions
        where referrer_reservation_id = $1
          and status <> 'revoked'`,
      [referrerReservationId]
    );
    return result.rows[0]?.count || 0;
  }

  async enqueueStandby(entry) {
    try {
      const result = await this.db.query(
        `insert into standby_entries (
          edition_id,
          shopify_customer_id,
          email,
          country,
          size_preference,
          status
        ) values ($1,$2,$3,$4,$5,'waiting')
        returning *`,
        [
          entry.editionId,
          entry.customerId,
          entry.email,
          entry.country || null,
          entry.size || null,
        ]
      );
      return mapStandby(result.rows[0]);
    } catch (error) {
      throw translateUnique(error);
    }
  }

  async promoteNextStandby(editionId, { offerDeadline }) {
    return this.withTransaction(async (client) => {
      const selected = await client.query(
        `select *
           from standby_entries
          where edition_id = $1 and status = 'waiting'
          order by sequence asc
          for update skip locked
          limit 1`,
        [editionId]
      );

      if (!selected.rows[0]) return null;

      const updated = await client.query(
        `update standby_entries
            set status = 'offered',
                promoted_at = now(),
                offer_deadline = $2
          where id = $1
          returning *`,
        [selected.rows[0].id, offerDeadline]
      );
      return mapStandby(updated.rows[0]);
    });
  }

  async recordEvent(type, payload) {
    const result = await this.db.query(
      `insert into edition_events (
        edition_id,
        reservation_id,
        event_type,
        payload
      ) values ($1,$2,$3,$4::jsonb)
      returning *`,
      [
        payload?.editionId || null,
        payload?.reservationId || null,
        type,
        JSON.stringify(payload || {}),
      ]
    );

    const row = result.rows[0];
    return {
      id: Number(row.id),
      type: row.event_type,
      payload: row.payload,
      createdAt: row.created_at,
    };
  }
}
