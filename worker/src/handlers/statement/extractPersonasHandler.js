import _, { get, has } from 'lodash';
import Promise from 'bluebird';
import Statement from 'lib/models/statement';
import wrapHandlerForStatement from 'worker/handlers/statement/wrapHandlerForStatement';
import { STATEMENT_EXTRACT_PERSONAS_QUEUE } from 'lib/constants/statements';

const getIfiFromActor = (actor) => {
  if (actor.mbox) {
    return {
      key: 'mbox',
      value: actor.mbox
    };
  } else if (actor.mbox_sha1sum) {
    return {
      key: 'mbox_sha1sum',
      value: actor.mbox_sha1sum,
    };
  } else if (actor.openid) {
    return {
      key: 'openid',
      value: actor.openid
    };
  } else if (actor.account) {
    return {
      key: 'account',
      value: actor.account
    };
  }
};

const updateAllMatchingStatements = async ({
  actor, // actor to match
  organisation, // organisation to match
  person, // persona to set on statement
  personaIdentifier // identifier to set on statement
}) => {
  let filter;
  if (has(actor, 'mbox')) {
    filter = {
      'statement.actor.mbox': get(actor, 'mbox')
    };
  } else if (has(actor, 'mbox_sha1sum')) {
    filter = {
      'statement.actor.mbox_sha1sum': get(actor, 'mbox_sha1sum')
    };
  } else if (has(actor, 'openid')) {
    filter = {
      'statement.actor.openid': get(actor, 'openid')
    };
  } else {
    filter = {
      'statement.actor.account.homePage': get(actor, ['account', 'homePage']),
      'statement.actor.account.name': get(actor, ['account', 'name'])
    };
  }

  await Statement.update({
    ...filter,
    organisation
  }, {
    person,
    personaIdentifier
  }, {
    multi: true
  });
};

const handleStatement = personaService => async (statement) => {
  const ifi = getIfiFromActor(statement.statement.actor);

  const {
    personaId,
    identifierId,
    wasCreated,
  } = await personaService.createUpdateIdentifierPersona({
    organisation: statement.organisation,
    ifi,
    personaName: statement.statement.actor.name,
  });

  const { persona } = await personaService.getPersona({
    organisation: statement.organisation,
    personaId
  });

  if (!wasCreated) {
    statement.personaIdentifier = identifierId;
    statement.person = {
      _id: personaId,
      display: persona.name
    };

    await statement.save();
  } else {
    await updateAllMatchingStatements({
      actor: statement.statement.actor,
      organisation: statement.organisation,
      person: {
        _id: personaId,
        display: persona.name
      },
      personaIdentifier: identifierId
    });
  }
};

const handleStatements = personaService => (statements) => {
  if (_.isArray(statements)) {
    const handleStatementWithPersonaService = handleStatement(personaService);
    return Promise.all(_.map(statements, handleStatementWithPersonaService));
  }
  return handleStatement(personaService)(statements);
};

export const extractPersonasStatementHandler = personaService =>
  (statements, done) =>
    handleStatements(personaService)(statements)
      .then(() => { done(null); })
      .catch(done);

// PROCESS START
export default personaService => wrapHandlerForStatement(
  STATEMENT_EXTRACT_PERSONAS_QUEUE,
  extractPersonasStatementHandler(personaService)
);
