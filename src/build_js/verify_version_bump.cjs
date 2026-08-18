
const { execSync, execFileSync } = require('child_process'),
      { readFileSync }           = require('fs'),
      semver                     = require('semver');

const pkg              = readFileSync('./package.json'),
      pJson            = JSON.parse(pkg),
      priv_version     = pJson.version;

/**
 * The version currently published to npm, or `null` when the package has never
 * been published.
 *
 * A package awaiting its first release is a normal state, not an error: `npm view`
 * exits nonzero with E404 and `execFileSync` throws, which would otherwise kill this
 * script before any comparison logic ran. Returning `null` lets the caller treat
 * "nothing to compare against" as a pass.
 *
 * @example
 *   publishedVersion('semver')          // => '7.6.3'
 *   publishedVersion('not-a-real-pkg')  // => null
 */
function publishedVersion(name) {
  try {
    return `${execFileSync('npm', ['view', name, 'version'], { stdio: ['ignore', 'pipe', 'ignore'] })}`.trim();
  } catch {
    return null;
  }
}

const public_version   = publishedVersion(pJson.name),
      last_commit_msg  = `${execSync('git show -s --format=%s')}`.trim().replace(/[^0-9a-z _\-=]/gi, '');

if (public_version === null) {
  console.log(`Not yet published; ${priv_version} would be the first release ☑`);
  // eslint-disable-next-line no-undef
  process.exit(0);
}



if (semver.valid(public_version)) {
  if (semver.valid(priv_version)) {
    if (semver.gt(public_version, priv_version)) {
      console.log(`Version regression: locally ${priv_version}, publicly ${public_version}`);
    } else {
      if (semver.gt(priv_version, public_version)) {

        try {

          console.log(`Version is updated; passing ☑\n  (public ${public_version}, private ${priv_version})\n\nApplying tags`);
          execSync(`git tag -a v${priv_version} -m ${JSON.stringify(last_commit_msg)}`);
          // eslint-disable-next-line no-undef
          process.exit(0);

        } catch (e) {

          console.log("Error!\n=====\n");

          console.log( e.stdout.toString() );

          console.log("\n-----\n");
          console.log( e.stderr.toString() );

          console.log("\n-----\n");

          console.log( require('util').inspect(e) );

          console.log("\n=====\n");

        }


      } else {
        console.log(`Version unchanged: locally ${priv_version}, publicly also ${public_version}`);
    } }
  } else {
    console.log(`Invalid private version ${priv_version}`);
} } else {
  console.log(`Invalid public version ${public_version}`);
}

// valid exit manually controls as 0; anything getting here was in error
// eslint-disable-next-line no-undef
process.exit(1);
