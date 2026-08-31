import { TransactionsService } from './transactions.service';

/** Minimal in-memory stand-in — just enough of transaction.create to exercise recordSystemTransaction's own GST-column wiring and invariant guard. */
function fakePrisma() {
  const rows: any[] = [];
  return {
    _rows: rows,
    transaction: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `txn-${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      }),
    },
  };
}

describe('TransactionsService.recordSystemTransaction — GST columns', () => {
  it('writes all six GST columns when a gst split is provided', async () => {
    const prisma = fakePrisma();
    const service = new TransactionsService(prisma as never);

    const txn = await service.recordSystemTransaction('bp-1', {
      amountPaise: 35282,
      type: 'SUBSCRIPTION_CHARGE' as never,
      status: 'SUCCEEDED' as never,
      provider: 'razorpay',
      gst: { basePaise: 29900, gstPaise: 5382, cgstPaise: 2691, sgstPaise: 2691, igstPaise: 0, placeOfSupplyStateCode: '27' },
    });

    expect(txn).toMatchObject({
      basePaise: 29900,
      gstPaise: 5382,
      cgstPaise: 2691,
      sgstPaise: 2691,
      igstPaise: 0,
      placeOfSupplyStateCode: '27',
    });
  });

  it('leaves all six GST columns null when no gst split is provided — a non-GST or legacy-plan transaction', async () => {
    const prisma = fakePrisma();
    const service = new TransactionsService(prisma as never);

    const txn = await service.recordSystemTransaction('bp-1', {
      amountPaise: 29900,
      type: 'SUBSCRIPTION_CHARGE' as never,
      status: 'SUCCEEDED' as never,
      provider: 'razorpay',
    });

    expect(txn.basePaise).toBeNull();
    expect(txn.gstPaise).toBeNull();
    expect(txn.cgstPaise).toBeNull();
    expect(txn.sgstPaise).toBeNull();
    expect(txn.igstPaise).toBeNull();
    expect(txn.placeOfSupplyStateCode).toBeNull();
  });

  it('refuses to record a gst split whose base+gst does not sum to the actual amountPaise — a construction bug, not a real-world case', async () => {
    const prisma = fakePrisma();
    const service = new TransactionsService(prisma as never);

    await expect(
      service.recordSystemTransaction('bp-1', {
        amountPaise: 35282,
        type: 'SUBSCRIPTION_CHARGE' as never,
        status: 'SUCCEEDED' as never,
        provider: 'razorpay',
        // Deliberately inconsistent: 29900 + 5382 = 35282, but amountPaise here is wrong on purpose.
        gst: { basePaise: 29900, gstPaise: 5382, cgstPaise: 2691, sgstPaise: 2691, igstPaise: 0, placeOfSupplyStateCode: '27' },
      } as never),
    ).resolves.toBeDefined(); // sanity: the matching case above must NOT throw

    await expect(
      service.recordSystemTransaction('bp-1', {
        amountPaise: 99999, // does not equal 29900 + 5382
        type: 'SUBSCRIPTION_CHARGE' as never,
        status: 'SUCCEEDED' as never,
        provider: 'razorpay',
        gst: { basePaise: 29900, gstPaise: 5382, cgstPaise: 2691, sgstPaise: 2691, igstPaise: 0, placeOfSupplyStateCode: '27' },
      }),
    ).rejects.toThrow(/does not|!==/);
    expect(prisma.transaction.create).toHaveBeenCalledTimes(1); // only the valid one above actually wrote a row
  });
});
