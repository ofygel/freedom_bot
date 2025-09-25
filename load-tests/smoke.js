import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { vus: 50, duration: '30s' };

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/health`);
  check(res, { 'status was 200': (r) => r.status === 200 });
  sleep(1);
}
