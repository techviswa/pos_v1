import { usersService } from '../users/users.service.js';
import { getEffectivePermissions, assertTenantAccess } from '../../shared/middleware/authGuard.middleware.js';
import { createHttpError } from '../../shared/utils/http-error.js';

const denied = () => createHttpError({ statusCode: 403, code: 'ACTOR_PERMISSION_REVOKED', message: 'The administrator no longer has authority for this POS operation' });

export async function authorizeBridgeActor(req, { businessId, tenantId, resource }) {
  const mode = req.get('x-admincore-actor-mode');
  // Existing trusted platform integrations remain supported. New queued tenant
  // commands always carry their initiating source identity, never a role claim.
  if (!mode || mode === 'platform') return undefined;
  if (mode !== 'tenant') throw denied();
  const userId = req.get('x-admincore-actor-id');
  if (!userId || userId.length > 200) throw denied();
  let actor;
  try { actor = await usersService.getUserById({ businessId, tenantId, userId }); }
  catch (error) { if (error.code === 'P2025' || error.statusCode === 404) throw denied(); throw error; }
  const role = String(actor.role || '').toLowerCase().replace(/[\s_-]/g, '');
  const owner = ['owner', 'systemowner'].includes(role);
  const permission = { products: 'products', outlets: 'settings', staff: 'staff' }[resource];
  if (!actor.active || !['owner', 'systemowner', 'manager'].includes(role) ||
      (!owner && req.get('x-admincore-owner-required') === 'true') || !getEffectivePermissions(actor).includes(permission)) throw denied();
  await assertTenantAccess({ user: actor, businessId, method: req.method, url: `/api/${resource}` });
  return { ...actor, admincore_owner_required: req.get('x-admincore-owner-required') === 'true' };
}
