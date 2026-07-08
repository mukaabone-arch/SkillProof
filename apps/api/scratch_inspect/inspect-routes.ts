import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { JobsController } from '../src/modules/jobs/jobs.controller';
import { CandidateJobsController } from '../src/modules/jobs/candidate-jobs.controller';
import { ROLES_KEY } from '../src/modules/auth/roles.decorator';

const R = Reflect as any;

function dump(label: string, Ctrl: any) {
  console.log(`\n=== ${label} ===`);
  console.log('base path:', R.getMetadata(PATH_METADATA, Ctrl));
  console.log('class guards:', (R.getMetadata(GUARDS_METADATA, Ctrl) || []).map((g: any) => g.name));
  console.log('class roles:', R.getMetadata(ROLES_KEY, Ctrl));
  const proto = Ctrl.prototype;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    const fn = proto[name];
    const path = R.getMetadata(PATH_METADATA, fn);
    if (path === undefined) continue;
    const method = R.getMetadata(METHOD_METADATA, fn);
    const guards = (R.getMetadata(GUARDS_METADATA, fn) || []).map((g: any) => g.name);
    const roles = R.getMetadata(ROLES_KEY, fn);
    console.log(`  [method=${method}] path="${path}" handler=${name} methodGuards=${JSON.stringify(guards)} methodRoles=${JSON.stringify(roles)}`);
  }
}

dump('JobsController (employer)', JobsController);
dump('CandidateJobsController (candidate)', CandidateJobsController);
