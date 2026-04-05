FROM cypress/included:15.12.0

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Use global Cypress from this image (avoids npx lookup inside the container).
ENV MLP_FORM_PORT=4000
ENV MLP_CYPRESS_CMD=cypress
ENV CI=true

EXPOSE 4000

CMD ["npm", "run", "mlp:form"]