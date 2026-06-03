# Seguridad y operación FacilPyme Agenda

Esta app es un frontend estático que lee y escribe en Firestore desde el navegador. Por eso, la seguridad efectiva depende de las reglas de Firestore del proyecto `facilpyme-agenda`.

## Cambios compatibles ya aplicados

- Los links de administración y reserva se mantienen iguales.
- Las reservas nuevas usan un ID determinístico por fecha y hora para reducir dobles reservas.
- Las reservas nuevas guardan `cancelToken` para permitir cancelación con enlace único.
- Los teléfonos se normalizan a celular chileno de 9 dígitos.
- El PIN `0000` ya no se acepta como nuevo PIN de profesional ni como nuevo PIN maestro.
- El panel setup ya no muestra el PIN por defecto en pantalla.

## Recomendación para reglas Firestore

No aplicar reglas nuevas sin probar en Firebase Rules Playground con datos reales. Como la app actual no usa Firebase Auth, las reglas no pueden distinguir con seguridad a un paciente, profesional o administrador; solo pueden validar forma de datos.

Un endurecimiento compatible inicial debería:

- Permitir lectura pública solo de datos profesionales necesarios para reservar: nombre, servicios, settings.
- Permitir creación de citas solo con campos esperados, `status == "confirmed"`, teléfono válido y fecha/hora con formato válido.
- Impedir update/delete público de profesionales, configuración, PIN y bloques.
- Permitir cancelación pública solo si se mantiene el mismo documento y se cambia `status` a `"cancelled"` con un `cancelToken` válido. Esta validación es limitada sin backend porque las reglas no deben exponer el token.
- Mover administración real a Firebase Auth o Cloud Functions en una fase siguiente.

## Siguiente paso recomendado

Para seguridad real sin complicar la operación, mantener los paneles actuales pero agregar una Cloud Function HTTPS para:

1. validar PIN maestro/profesional,
2. emitir una sesión corta,
3. crear/editar/borrar profesionales,
4. crear/cancelar citas con validación centralizada.

Ese cambio puede hacerse por etapas: primero backend paralelo, luego migrar pantallas, finalmente cerrar reglas Firestore.
