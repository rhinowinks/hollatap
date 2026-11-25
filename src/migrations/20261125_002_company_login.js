// Company (Teams) admins log in with a username and password, then a code sent to their email.
exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('username', 40).unique();
    t.string('password_hash', 200);
    t.timestamp('password_set_at');
    t.string('google_sub', 64);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('username');
    t.dropColumn('password_hash');
    t.dropColumn('password_set_at');
    t.dropColumn('google_sub');
  });
};
