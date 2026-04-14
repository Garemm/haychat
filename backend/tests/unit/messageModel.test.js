import MessageModel from '../../src/models/messageModel.js';

beforeEach(() => {
  MessageModel.clear();
});

// ─── create() ────────────────────────────────────────────────────────────────

describe('MessageModel.create()', () => {
  test('returns an object with the expected shape', () => {
    const msg = MessageModel.create({ roomId: 'room-1', sender: 'Alice', text: 'Hola' });

    expect(msg).toMatchObject({
      roomId:  'room-1',
      sender:  'Alice',
      text:    'Hola',
    });
    expect(typeof msg.id).toBe('string');
    expect(msg.id).toHaveLength(36); // UUID v4
    expect(typeof msg.createdAt).toBe('string');
    expect(new Date(msg.createdAt).toString()).not.toBe('Invalid Date');
  });

  test('assigns unique IDs to different messages', () => {
    const a = MessageModel.create({ roomId: 'r', sender: 'A', text: 'first' });
    const b = MessageModel.create({ roomId: 'r', sender: 'B', text: 'second' });

    expect(a.id).not.toBe(b.id);
  });

  test('persists the message so findByRoom can retrieve it', () => {
    MessageModel.create({ roomId: 'room-X', sender: 'Bot', text: 'Hola!' });

    const found = MessageModel.findByRoom('room-X');
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe('Hola!');
  });

  test('stores multiple messages in insertion order', () => {
    MessageModel.create({ roomId: 'seq', sender: 'A', text: 'first' });
    MessageModel.create({ roomId: 'seq', sender: 'B', text: 'second' });
    MessageModel.create({ roomId: 'seq', sender: 'A', text: 'third' });

    const messages = MessageModel.findByRoom('seq');
    expect(messages.map((m) => m.text)).toEqual(['first', 'second', 'third']);
  });
});

// ─── findByRoom() ─────────────────────────────────────────────────────────────

describe('MessageModel.findByRoom()', () => {
  test('returns an empty array when no messages exist', () => {
    expect(MessageModel.findByRoom('empty')).toEqual([]);
  });

  test('returns only messages for the requested room', () => {
    MessageModel.create({ roomId: 'room-A', sender: 'Alice', text: 'msg A' });
    MessageModel.create({ roomId: 'room-B', sender: 'Bob',   text: 'msg B' });

    const roomA = MessageModel.findByRoom('room-A');
    expect(roomA).toHaveLength(1);
    expect(roomA[0].roomId).toBe('room-A');
  });

  test('returns all messages for a room with multiple entries', () => {
    MessageModel.create({ roomId: 'chat', sender: 'Alice', text: 'hi' });
    MessageModel.create({ roomId: 'chat', sender: 'Bot',   text: 'hello' });
    MessageModel.create({ roomId: 'chat', sender: 'Alice', text: 'bye' });

    expect(MessageModel.findByRoom('chat')).toHaveLength(3);
  });

  test('does not mutate the internal store on the returned array', () => {
    MessageModel.create({ roomId: 'r', sender: 'A', text: 'x' });

    const first = MessageModel.findByRoom('r');
    first.push({ id: 'fake', roomId: 'r', sender: 'X', text: 'injected', createdAt: '' });

    // Internal store should still only have 1 item
    expect(MessageModel.findByRoom('r')).toHaveLength(1);
  });
});

// ─── clear() ─────────────────────────────────────────────────────────────────

describe('MessageModel.clear()', () => {
  test('empties the store', () => {
    MessageModel.create({ roomId: 'r', sender: 'A', text: 'x' });
    MessageModel.create({ roomId: 'r', sender: 'B', text: 'y' });

    MessageModel.clear();

    expect(MessageModel.findByRoom('r')).toEqual([]);
  });

  test('calling clear on an already-empty store does not throw', () => {
    expect(() => MessageModel.clear()).not.toThrow();
  });
});
