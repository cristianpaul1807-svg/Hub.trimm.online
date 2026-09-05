/**
 * Los periodos de las pantallas de métricas, en un solo sitio.
 *
 * Estaban copiados en cinco pantallas y con el tiempo dejaron de decir lo
 * mismo: el panel entendía «mes» como el mes natural —desde el día 1— y las
 * pantallas de KPIs y Análisis como los últimos 30 días. El día 5 de un mes,
 * «semana» son 7 días y «mes» solo 5, así que el panel enseñaba más
 * facturación en la semana que en el mes. La cifra era correcta las dos
 * veces; lo que no cuadraba era la palabra.
 *
 * Aquí todos los periodos son ventanas móviles que terminan ahora y se
 * contienen unas a otras: hoy ⊆ 7 días ⊆ 30 ⊆ 90 ⊆ 365. Por construcción, un
 * periodo más largo nunca puede dar una cifra menor que uno más corto.
 *
 * «Hoy» es el día en curso desde medianoche y no las últimas 24 horas: quien
 * pregunta cuánto lleva hoy pregunta por su día, no por el turno de ayer.
 */

export type Period = 'today' | 'week' | 'month' | 'quarter' | 'year';

/** Cuántos días atrás empieza cada ventana. */
export const DIAS: Record<Exclude<Period, 'today'>, number> = {
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
};

/**
 * @param offset 0 es el periodo actual; 1, el anterior de la misma duración,
 *   que es contra el que compara la pantalla de Comparativa.
 * @param ahora Se puede fijar para poder probar la función; en la aplicación
 *   siempre es el momento actual.
 */
export function rangoDe(
  period: Period,
  offset = 0,
  ahora: Date = new Date(),
): { from: Date; to: Date } {
  const to = new Date(ahora);
  const from = new Date(ahora);

  if (period === 'today') {
    from.setHours(0, 0, 0, 0);
  } else {
    from.setDate(from.getDate() - DIAS[period]);
    from.setHours(0, 0, 0, 0);
  }

  // El periodo anterior es la misma ventana desplazada hacia atrás: termina
  // justo donde empieza esta y dura lo mismo.
  if (offset) {
    const duracion = to.getTime() - from.getTime();
    to.setTime(to.getTime() - duracion * offset);
    from.setTime(from.getTime() - duracion * offset);
  }

  return { from, to };
}
