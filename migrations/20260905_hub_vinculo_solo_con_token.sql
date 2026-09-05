-- Vincular una sucursal al Hub deja de ser gratis: o es tuya, o hay token.
--
-- La política de alta decía solo «la conexión es tuya»
-- (hub_owner_id = auth.uid()) y no decía nada del negocio. Con la sesión de
-- cualquier cuenta del Hub bastaba un INSERT con el id de una sucursal ajena
-- para acabar viendo su facturación, su lista de clientes y poder escribirles
-- una campaña. Y esos ids no son secretos: businesses se lee en público
-- porque de ahí sale la página de reserva.
--
-- A partir de aquí solo existen dos caminos para que nazca una conexión:
--
--   · el negocio es tuyo en Trimm (businesses.owner_id = auth.uid()), que es
--     el caso del dueño que abre el Hub para su propio salón;
--   · alguien te ha dado el token de su negocio y lo has canjeado con
--     claim_hub_token —de un solo uso y con caducidad—, que es SECURITY
--     DEFINER y por eso sigue funcionando aunque esta política no lo permita.
--
-- Lo que se cierra es el tercer camino, el que no debería haber existido:
-- escribir la fila a mano desde el navegador.

DROP POLICY IF EXISTS "hub_owner_insert" ON public.hub_connections;

CREATE POLICY "hub_conexion_negocio_propio" ON public.hub_connections
  FOR INSERT TO authenticated
  WITH CHECK (
    hub_owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_id
        AND b.owner_id = auth.uid()
    )
  );

COMMENT ON POLICY "hub_conexion_negocio_propio" ON public.hub_connections IS
  'Alta directa solo del negocio propio. Cualquier otra sucursal entra por claim_hub_token.';
