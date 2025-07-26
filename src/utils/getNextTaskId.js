import Counter from '../models/Counter.js';

const getNextTaskId = async () => {
  const result = await Counter.findOneAndUpdate(
    { name: 'taskId' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return result.seq;
};

export default getNextTaskId;
