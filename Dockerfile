FROM cypress/included:15.12.0

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ENV CI=true
ENV MLP_CYPRESS_CMD=cypress

EXPOSE 4000

ENTRYPOINT ["npm", "run", "mlp:form"]