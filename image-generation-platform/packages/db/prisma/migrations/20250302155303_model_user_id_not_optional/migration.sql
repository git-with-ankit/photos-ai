/*
  Warnings:

  - Made the column `userId` on table `Model` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Model" ALTER COLUMN "userId" SET NOT NULL;
