// 2. test script for k6, loading papaparse and using it to parse a CSV file, which is stored in the SharedArray

import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import http from 'k6/http';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';

const csvData = new SharedArray('data_sample_1', function () {
  return papaparse.parse(open('./data_sample_1.csv'), { header: true }).data;
});

export default function () {
  const randomIndex = Math.floor(Math.random() * csvData.length);
  const randomData = csvData[randomIndex];
  console.log(randomData);
  http.get('https://test.k6.io');
  sleep(1);
}