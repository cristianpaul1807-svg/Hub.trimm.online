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

/** Una cita, tal como la necesita la gráfica. */
export interface PuntoBruto { start_time: string; price: number | string | null }

/**
 * Agrupa la facturación para la gráfica del panel.
 *
 * La clave de agrupación es ordenable —2026-09-05 o 2026-09— y la etiqueta
 * bonita se pone al final. Antes la clave era el propio texto de la etiqueta
 * («vie, 5»), y ese texto se repite: el día 5 de cada mes cae en el mismo
 * hueco, así que en periodos largos meses distintos se sumaban en la misma
 * barra. Y sin ordenar por la clave, las barras salían en el orden en que la
 * base de datos devolviera las citas, que no es ninguno en particular.
 *
 * @param porMes Agrupar por mes en vez de por día. 365 barras de un día no se
 *   leen, y la gráfica está para ver la tendencia.
 */
export function serieDeFacturacion(
  citas: PuntoBruto[],
  porMes: boolean,
  lang = 'es',
): Array<{ date: string; total: number }> {
  const suma: Record<string, number> = {};

  for (const cita of citas) {
    const d = new Date(cita.start_time);
    if (Number.isNaN(d.getTime())) continue;
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const clave = porMes ? mes : `${mes}-${String(d.getDate()).padStart(2, '0')}`;
    suma[clave] = (suma[clave] ?? 0) + (Number(cita.price) || 0);
  }

  return Object.keys(suma).sort().map((clave) => {
    // Mediodía a propósito: a medianoche, un huso al oeste de UTC devuelve
    // el día anterior y la etiqueta no coincidiría con su barra.
    const d = new Date(`${clave}${porMes ? '-01' : ''}T12:00:00`);
    return {
      date: porMes
        ? d.toLocaleDateString(lang, { month: 'short', year: '2-digit' })
        : d.toLocaleDateString(lang, { weekday: 'short', day: 'numeric' }),
      total: suma[clave],
    };
  });
}
