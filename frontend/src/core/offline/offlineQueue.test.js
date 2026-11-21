import axios from "axios";
import {
  applyUnsyncedStock,
  discardOfflineBill,
  getOfflineQueue,
  getOfflineRecoveryCopy,
  getOfflineStorageError,
  isNetworkFailure,
  queueOfflineBill,
  replayOfflineQueue,
  retryOfflineBill,
  setOfflineOwner,
} from "./offlineQueue";

jest.mock("axios", () => ({ post: jest.fn() }));

const bill = (id, total = 100) => ({ payload: { client_request_id: id, items: [{ id: "p1", quantity: 1 }], payment_type: "Cash" }, summary: { label: `OFFLINE-${id}`, total } });
const networkError = () => Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
const refused = (message) => ({ response: { status: 409, data: { error: { message } } } });

beforeEach(() => {
  localStorage.clear();
  axios.post.mockReset();
  setOfflineOwner({ id: "u1", business_id: "b1" });
});

test("a queued bill is sent once and removed when the server accepts it", async () => {
  queueOfflineBill(bill("k1"));
  queueOfflineBill(bill("k1"));
  expect(getOfflineQueue()).toHaveLength(1);
  expect(getOfflineQueue()[0].payload.offline_created_at).toBeTruthy();
  axios.post.mockResolvedValueOnce({ data: { id: "bill-1" } });
  const result = await replayOfflineQueue();
  expect(result.replayed).toBe(1);
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post.mock.calls[0][1].client_request_id).toBe("k1");
  expect(getOfflineQueue()).toHaveLength(0);
});

test("while the server is unreachable bills stay pending and are retried later", async () => {
  queueOfflineBill(bill("k1"));
  queueOfflineBill(bill("k2"));
  axios.post.mockRejectedValueOnce(networkError());
  await replayOfflineQueue();
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(getOfflineQueue().map((row) => row.status)).toEqual(["pending", "pending"]);
  axios.post.mockResolvedValue({ data: {} });
  await replayOfflineQueue();
  expect(getOfflineQueue()).toHaveLength(0);
});

test("a bill the server refuses is kept for review, not dropped", async () => {
  queueOfflineBill(bill("k1"));
  axios.post.mockRejectedValueOnce(refused("Only 0 x Tea left in stock"));
  const result = await replayOfflineQueue();
  expect(result.failed).toBe(1);
  expect(getOfflineQueue()[0]).toMatchObject({ status: "failed", last_error: "Only 0 x Tea left in stock" });
  axios.post.mockResolvedValueOnce({ data: {} });
  await retryOfflineBill("k1");
  expect(getOfflineQueue()).toHaveLength(0);
});

test("only refused bills can be discarded", () => {
  queueOfflineBill(bill("k1"));
  discardOfflineBill("k1");
  expect(getOfflineQueue()).toHaveLength(1);
});

test("queues are separate per user and business", () => {
  queueOfflineBill(bill("k1"));
  setOfflineOwner({ id: "u2", business_id: "b1" });
  expect(getOfflineQueue()).toHaveLength(0);
  setOfflineOwner({ id: "u1", business_id: "b1" });
  expect(getOfflineQueue()).toHaveLength(1);
});

test("network failures are told apart from refusals", () => {
  expect(isNetworkFailure(networkError())).toBe(true);
  expect(isNetworkFailure(refused("no"))).toBe(false);
});

test("units in unsynced bills are held back from the stock shown", () => {
  queueOfflineBill({ payload: { client_request_id: "k1", items: [{ id: "p1", quantity: 2 }, { id: "p2", quantity: 1 }] }, summary: {} });
  queueOfflineBill({ payload: { client_request_id: "k2", items: [{ id: "p1", quantity: 1 }] }, summary: {} });
  const products = applyUnsyncedStock([{ id: "p1", stock: 5 }, { id: "p2", stock: 0 }, { id: "p3", stock: 4 }]);
  expect(products.map((product) => product.stock)).toEqual([2, 0, 4]);
});

test('capacity refuses a new receipt without dropping any existing receipt', () => {
  for (let index = 0; index < 300; index++) queueOfflineBill(bill(`capacity-${index}`));
  expect(() => queueOfflineBill(bill('capacity-overflow'))).toThrow(/300 unsynced/);
  expect(getOfflineQueue()).toHaveLength(300);
  expect(getOfflineQueue().some(row => row.id === 'capacity-0')).toBe(true);
});

test('a receipt added during replay survives the earlier acknowledgement', async () => {
  queueOfflineBill(bill('first'));
  let accept;
  axios.post.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
  const sending = replayOfflineQueue();
  queueOfflineBill(bill('new-during-request'));
  accept({ data: { id: 'recorded' } });
  await sending;
  expect(getOfflineQueue().map(row => row.id)).toEqual(['new-during-request']);
});

test('switching accounts cannot move old receipts into the new queue or send its remaining bills', async () => {
  queueOfflineBill(bill('first')); queueOfflineBill(bill('second'));
  let accept;
  axios.post.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
  const sending = replayOfflineQueue();
  setOfflineOwner({ id: 'other', business_id: 'other-business' });
  queueOfflineBill(bill('other-account'));
  accept({ data: { id: 'recorded' } });
  await sending;
  expect(getOfflineQueue().map(row => row.id)).toEqual(['other-account']);
  expect(axios.post).toHaveBeenCalledTimes(1);
  setOfflineOwner({ id: 'u1', business_id: 'b1' });
  expect(getOfflineQueue().map(row => row.id)).toEqual(['second']);
});

test('corrupt legacy data stays untouched and can be recovered rather than overwritten', () => {
  localStorage.setItem('cashflow-offline-bills:b1:u1', '{broken saved receipt');
  expect(() => queueOfflineBill(bill('new'))).toThrow(/cannot be read/);
  expect(localStorage.getItem('cashflow-offline-bills:b1:u1')).toBe('{broken saved receipt');
  expect(getOfflineStorageError()).toMatch(/cannot be read/);
  expect(getOfflineRecoveryCopy()).toContain('broken saved receipt');
});

test('storage exhaustion cannot report successful capture', () => {
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  try { expect(() => queueOfflineBill(bill('unsaved'))).toThrow(/could not save/); }
  finally { write.mockRestore(); }
  expect(getOfflineQueue()).toHaveLength(0);
});

test('legacy receipts replay safely and terminal markers prevent resurrection', async () => {
  const old = { ...bill('legacy'), id: 'legacy', status: 'pending', queued_at: new Date().toISOString(), attempts: 0 };
  localStorage.setItem('cashflow-offline-bills:b1:u1', JSON.stringify([old]));
  axios.post.mockResolvedValue({ data: {} });
  await replayOfflineQueue();
  expect(getOfflineQueue()).toHaveLength(0);
  await replayOfflineQueue();
  expect(axios.post).toHaveBeenCalledTimes(1);
});

test('failure to save a server acknowledgement retains the receipt for idempotent recovery', async () => {
  queueOfflineBill(bill('ack-storage-failure'));
  axios.post.mockResolvedValue({ data: { id: 'recorded-on-server' } });
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  try { await expect(replayOfflineQueue()).rejects.toThrow(/could not save/); }
  finally { write.mockRestore(); }
  expect(getOfflineQueue()[0]).toMatchObject({ id: 'ack-storage-failure', status: 'pending' });
  await replayOfflineQueue();
  expect(axios.post.mock.calls.every(call => call[1].client_request_id === 'ack-storage-failure')).toBe(true);
  expect(getOfflineQueue()).toHaveLength(0);
});

test('the same checkout ID cannot silently discard a changed payload', () => {
  queueOfflineBill(bill('same-checkout'));
  expect(() => queueOfflineBill({ ...bill('same-checkout'), payload: { ...bill('same-checkout').payload, items: [{ id: 'p1', quantity: 2 }] } })).toThrow(/different saved receipt/);
  expect(getOfflineQueue()[0].payload.items[0].quantity).toBe(1);
});
