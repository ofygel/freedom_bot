import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 200,
  duration: '60s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

export default function () {
  const tgPayload = JSON.stringify({
    update_id: __ITER,
    message: {
      message_id: __ITER,
      from: { id: 123, is_bot: false, first_name: 'Load', last_name: 'Test' },
      chat: { id: 123, type: 'private' },
      date: Date.now() / 1000,
      text: '/start',
    },
  });
  const res = http.post(
    `${__ENV.TARGET_URL}/bot/${__ENV.WEBHOOK_SECRET}`,
    tgPayload,
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { '200 OK': (r) => r.status === 200 });
  sleep(0.1);
}
