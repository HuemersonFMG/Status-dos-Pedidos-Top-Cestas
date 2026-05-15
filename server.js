// =========================
// 📦 DOWNLOAD COMPROVANTES
// =========================

app.post(
  '/api/baixar-comprovantes',
  async (req, res) => {

    try {

      const { pedidos } =
        req.body;

      if (
        !Array.isArray(pedidos) ||
        !pedidos.length
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Nenhum pedido informado'
          });
      }

      const cookie =
        await login();

      res.setHeader(
        'Content-Type',
        'application/zip'
      );

      res.setHeader(
        'Content-Disposition',
        'attachment; filename=comprovantes.zip'
      );

      const archive =
        archiver('zip', {

          zlib: {
            level: 9
          }
        });

      archive.on(
        'error',
        err => {

          console.error(
            '❌ ERRO ZIP:',
            err
          );

          if (!res.headersSent) {

            res.status(500)
            .end();
          }
        }
      );

      archive.pipe(res);

      for (const nunota of pedidos) {

        try {

          const pedidoNum =
            Number(nunota);

          if (
            !pedidoNum ||
            isNaN(pedidoNum)
          ) {

            console.log(
              `⚠️ NUNOTA inválido: ${nunota}`
            );

            continue;
          }

          console.log(
            `🔍 PROCESSANDO ${pedidoNum}`
          );

          // =========================
          // 📷 IMAGEM
          // =========================

          const imgUrl =
            `${BASE_URL}/mge/AD_APPENTFOTO@FOTO@NUNOTA=${pedidoNum}@SEQ=1.dbimage`;

          const imgResponse =
            await fetch(
              imgUrl,
              {

                headers: {
                  Cookie: cookie
                }
              }
            );

          if (imgResponse.ok) {

            let buffer;

            // Compatibilidade node-fetch
            if (typeof imgResponse.buffer === 'function') {

              buffer =
                await imgResponse.buffer();

            } else {

              const arrayBuffer =
                await imgResponse.arrayBuffer();

              buffer =
                Buffer.from(arrayBuffer);
            }

            if (
              buffer &&
              buffer.length > 0
            ) {

              archive.append(
                buffer,
                {

                  name:
                    `Comprovante_${pedidoNum}.jpg`
                }
              );

              console.log(
                `✅ IMG ${pedidoNum}`
              );

              continue;
            }
          }

          // =========================
          // 📄 PDF
          // =========================

          const payload = {

            serviceName:
              'DbExplorerSP.executeQuery',

            requestBody: {

              sql: `
                SELECT AD_COMPROVTRANSP
                FROM TGFCAB
                WHERE NUNOTA = ${pedidoNum}
              `
            }
          };

          const responsePdf =
            await fetch(
              `${SERVICE_URL}?serviceName=DbExplorerSP.executeQuery&outputType=json`,
              {

                method: 'POST',

                headers: {

                  'Content-Type':
                    'application/json',

                  'Cookie':
                    cookie
                },

                body:
                  JSON.stringify(payload)
              }
            );

          const json =
            await responsePdf.json();

          const registro =
            json?.responseBody
            ?.rows?.[0];

          if (
            registro &&
            registro[0]
          ) {

            const pdfBuffer =
              Buffer.from(
                registro[0],
                'base64'
              );

            if (
              pdfBuffer.length > 0
            ) {

              archive.append(
                pdfBuffer,
                {

                  name:
                    `Comprovante_${pedidoNum}.pdf`
                }
              );

              console.log(
                `✅ PDF ${pedidoNum}`
              );
            }
          }

        } catch (errInterno) {

          console.error(
            `❌ ERRO ITEM ${nunota}:`,
            errInterno.message
          );
        }
      }

      await archive.finalize();

      console.log(
        '✅ ZIP FINALIZADO'
      );

    } catch (err) {

      console.error(
        '❌ ERRO GERAL ZIP:',
        err
      );

      if (!res.headersSent) {

        res.status(500)
        .json({

          erro:
            err.message
        });
      }
    }
  }
);